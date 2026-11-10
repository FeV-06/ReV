import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { readJsonLimited } from './body';
import { activeSlackConnection, listSlackChannels } from './slack';
import { analyzeGitSymbols } from './symbols';
import type { Artifact } from '@/lib/contracts';

const exec = promisify(execFile);
const localCommitLimit = 100;

function gitAuthor(name: string, email: string) {
  return /^(?:\d+\+)?([\w-]+)@users\.noreply\.github\.com$/i.exec(email)?.[1] ?? name;
}

async function localGitRoot() {
  return git('rev-parse', '--show-toplevel').then(root => root.trimEnd()).catch(() => null);
}

async function localGitAuthors() {
  const log = await git('--no-pager', 'log', '-z', '--no-notes', '--no-show-signature',
    `--max-count=${localCommitLimit}`, '--format=%aN%x00%aE', 'HEAD', '--').catch(() => '');
  const fields = log.split('\0');
  const authors = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const author = gitAuthor(fields[i], fields[i + 1]).trim();
    if (author && author.length <= 120 && !authors.has(author.toLowerCase())) {
      authors.set(author.toLowerCase(), author);
    }
  }
  return [...authors.values()];
}
async function gitInDir(dir: string, ...args: string[]) {
  const { stdout } = await exec('git', ['-C', dir, ...args], {
    timeout: 15_000, maxBuffer: 4_000_000,
  });
  return stdout;
}

async function git(...args: string[]) {
  return gitInDir(process.env.REV_GIT_DIR || process.cwd(), ...args);
}

function slackChannels() {
  return [...new Set((process.env.REV_SLACK_CHANNEL_IDS || '').split(',').map(id => id.trim()).filter(Boolean))];
}

export async function connectedSources() {
  const root = await localGitRoot();
  return {
    localGit: root ? basename(root) : null,
    gitAuthors: root ? await localGitAuthors() : [],
    slack: Boolean(process.env.REV_SLACK_BOT_TOKEN && slackChannels().length),
  };
}

export async function importLocalGit(projectDir?: string, contributor?: string) {
  const root = projectDir || await localGitRoot();
  if (!root) throw new Error('No local Git checkout found. Check REV_GIT_DIR.');
  const limit = localCommitLimit;
  const log = await gitInDir(root, '--no-pager', 'log', '-z', '--no-notes', '--no-show-signature', `--max-count=${limit + 1}`, '--format=%x00%H%x00%aN%x00%aE%x00%aI%x00%B', '--name-only', 'HEAD', '--')
    .catch(() => { throw new Error('Could not read local Git history. Check that the checkout has commits.'); });
  const fields = log.split('\0');
  const artifacts: Artifact[] = [];
  let i = 1;
  const recentShas: { sha: string; author: string; timestamp: string }[] = [];

  while (i + 4 < fields.length && artifacts.length < limit) {
    const [sha, name, email, timestamp, text] = fields.slice(i, i + 5);
    i += 5;
    const paths: string[] = [];
    while (fields[i]) {
      paths.push(paths.length ? fields[i] : fields[i].replace(/^\n/, ''));
      i++;
    }
    i++;
    const author = gitAuthor(name, email);
    artifacts.push({
      id: randomUUID(),
      kind: 'git_commit',
      externalId: sha,
      text: `Commit ${sha.slice(0, 7)}: ${text.trim()}`,
      author,
      timestamp,
      paths: paths.slice(0, 100),
      url: null,
      sourceRef: `${basename(root)}@${sha}`,
    });
    if (recentShas.length < 5) {
      recentShas.push({ sha, author, timestamp });
    }
  }

  // Extract changed AST symbols from recent commits
  for (const { sha, author, timestamp } of recentShas) {
    try {
      const symReport = await analyzeGitSymbols(root, sha);
      for (const f of symReport.files) {
        for (const s of f.changedSymbols) {
          artifacts.push({
            id: randomUUID(),
            kind: 'code_symbol',
            externalId: `${sha.slice(0, 7)}:${f.filePath}:${s.symbol.name}`,
            text: `Symbol ${s.symbol.name} (${s.symbol.kind}) ${s.changeKind} in ${f.filePath}. Signature: ${s.symbol.signature || s.symbol.name}`,
            author,
            timestamp,
            paths: [f.filePath],
            url: null,
            sourceRef: `${f.filePath}#${s.symbol.name}`,
          });
        }
      }
    } catch {}
  }

  // Extract working modifications
  try {
    const statusOut = await gitInDir(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all');
    const entries = statusOut.split('\0').filter(Boolean);
    for (const entry of entries.slice(0, 50)) {
      if (entry.length >= 4) {
        const filePath = entry.slice(3);
        const code = entry.slice(0, 2).trim();
        artifacts.push({
          id: randomUUID(),
          kind: 'working_change',
          externalId: `working:${filePath}`,
          text: `Working change in ${filePath} (${code === 'M' ? 'Modified' : 'Untracked'}) in ${basename(root)}.`,
          author: contributor || 'local',
          timestamp: new Date().toISOString(),
          paths: [filePath],
          url: null,
          sourceRef: `working:${filePath}`,
        });
      }
    }
  } catch {}

  return { artifacts, warnings: i + 4 < fields.length ? ['Only the latest 100 commits reachable from HEAD were imported.'] : [] };
}

const slackHistory = z.object({
  ok: z.literal(true),
  has_more: z.boolean().optional(),
  response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
  messages: z.array(z.object({ ts: z.string().regex(/^\d{1,12}\.\d+$/), text: z.string().optional(), user: z.string().optional() })),
});

export async function importSlackChannels(selected: string[] = []) {
  const connection = selected.length ? await activeSlackConnection() : null;
  const token = selected.length ? connection?.token : process.env.REV_SLACK_BOT_TOKEN;
  const channels = selected.length ? [...new Set(selected)] : slackChannels();
  if (!token || !channels.length || channels.length > 5 || channels.some(id => !/^[CG][A-Z0-9]+$/.test(id))) {
    throw new Error('Connect Slack and choose up to five channels, or configure a Slack bot token.');
  }
  if (connection && token) {
    const available = new Set((await listSlackChannels(token)).map(channel => channel.id));
    if (channels.some(channel => !available.has(channel))) throw new Error('A selected Slack channel is no longer available.');
  }
  const artifacts: Artifact[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const channel of channels) {
    try {
      const query = new URLSearchParams({ channel, limit: '15' });
      const response = await fetch(`https://slack.com/api/conversations.history?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        warnings.push(`Slack channel ${channel}: history request failed (HTTP ${response.status}).`);
        continue;
      }
      const history = slackHistory.parse(await readJsonLimited(response, 1_000_000));
      if (history.has_more || history.response_metadata?.next_cursor) warnings.push(`Slack channel ${channel}: only the first page was imported.`);
      for (const { ts, user, text } of history.messages) {
        const externalId = connection ? `${connection.workspaceId}:${channel}:${ts}` : `${channel}:${ts}`;
        if (!text?.trim() || seen.has(externalId)) continue;
        seen.add(externalId);
        artifacts.push({ id: randomUUID(), kind: 'slack_message', externalId, text,
          author: user ?? null, timestamp: new Date(Number(ts) * 1000).toISOString(), url: null, sourceRef: `Slack ${channel} at ${ts}` });
      }
    } catch {
      warnings.push(`Slack channel ${channel}: could not read history. Check bot access and try again.`);
    }
  }
  if (!artifacts.length) warnings.push('No text messages were imported from the connected Slack channels.');
  return { artifacts, warnings };
}
