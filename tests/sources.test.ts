import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { connectedSources, importLocalGit, importSlackChannels } from '../src/lib/server/sources';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('detects a configured checkout and imports its committed history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rev-checkout-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args]);
    git('init', '--quiet');
    mkdirSync(join(dir, 'billing'));
    writeFileSync(join(dir, 'billing', 'retry.ts'), 'retry');
    git('add', 'billing/retry.ts');
    git('-c', 'user.name=Example Author', '-c', 'user.email=123+example-author@users.noreply.github.com',
      '-c', 'commit.gpgSign=false', 'commit', '--quiet', '--allow-empty', '-m', 'Record a decision');
    vi.stubEnv('REV_GIT_DIR', dir);
    expect(await connectedSources()).toMatchObject({ localGit: basename(dir), gitAuthors: ['example-author'] });
    const result = await importLocalGit({ includeWorkspaceChanges: false, includeSymbols: false });
    expect(result.artifacts).toMatchObject([{ kind: 'git_commit', author: 'example-author', text: 'Record a decision', paths: ['billing/retry.ts'] }]);
    expect(result.warnings).toEqual([]);
    git('-c', 'user.name=Other Author', '-c', 'user.email=other@example.test',
      '-c', 'commit.gpgSign=false', 'commit', '--quiet', '--allow-empty', '-m', 'Other contributor change');
    for (const identity of ['Example Author', 'EXAMPLE-AUTHOR']) {
      const filtered = await importLocalGit([identity]);
      expect(filtered.artifacts.map(source => source.text)).toEqual(['Record a decision']);
    }
    expect((await importLocalGit(['unknown'])).artifacts).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('combines strict contributor history with shared workspace changes and committed docs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rev-merge-scope-'));
  const other = mkdtempSync(join(tmpdir(), 'rev-other-repo-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args]);
    git('init', '--quiet');
    writeFileSync(join(dir, 'README.md'), '# Correct workspace documentation\n');
    git('add', '.');
    git('-c', 'user.name=Base Author', '-c', 'user.email=base@example.test', '-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'Base commit');
    writeFileSync(join(dir, 'alice.ts'), 'export function alice() { return 1; }\n');
    git('add', '.');
    git('-c', 'user.name=Alice Example', '-c', 'user.email=alice@example.test', '-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'Alice commit');
    writeFileSync(join(dir, 'bob.ts'), 'export function bob() { return 2; }\n');
    git('add', '.');
    git('-c', 'user.name=Bob Example', '-c', 'user.email=bob@example.test', '-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'Bob commit');
    writeFileSync(join(dir, 'alice.ts'), 'export function alice() { return 3; }\n');
    writeFileSync(join(dir, 'untracked.ts'), 'export const work = true;\n');
    vi.stubEnv('REV_GIT_DIR', other);
    const { importLocalDocs } = await import('../src/lib/server/sources');
    const { artifacts } = await importLocalGit({ projectDir: dir, authors: ['Alice Example'], includeSymbols: true });
    expect(artifacts.filter(a => a.kind === 'git_commit').map(a => a.text)).toEqual(['Alice commit']);
    const symbols = artifacts.filter(a => a.kind === 'code_symbol');
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols.every(a => a.author === 'Alice Example' && !a.text.includes('bob'))).toBe(true);
    const working = artifacts.filter(a => a.kind === 'working_change');
    expect(working.map(a => a.paths?.[0]).sort()).toEqual(['alice.ts', 'untracked.ts']);
    expect(working.every(a => a.author === null && !a.githubLogin && a.text.includes('Shared, unattributed'))).toBe(true);
    expect((await importLocalDocs(dir)).artifacts.map(a => a.text)).toContain('# Correct workspace documentation\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
}, 30_000);

it('imports authorized Slack channel messages and reports partial coverage', async () => {
  vi.stubEnv('REV_SLACK_BOT_TOKEN', 'test-token');
  vi.stubEnv('REV_SLACK_CHANNEL_IDS', 'C123,C456');
  const fetchHistory = vi.fn()
    .mockResolvedValueOnce(Response.json({ ok: true, has_more: true, messages: [
      { ts: '1760000000.123456', user: 'U123', text: 'Example decision' },
    ] }))
    .mockResolvedValueOnce(Response.json({ ok: false, error: 'not_in_channel' }));
  vi.stubGlobal('fetch', fetchHistory);

  const result = await importSlackChannels();
  expect(fetchHistory).toHaveBeenCalledTimes(2);
  expect(fetchHistory.mock.calls.map(([url]) => new URL(url).searchParams.get('channel'))).toEqual(['C123', 'C456']);
  expect(result.artifacts).toMatchObject([{ kind: 'slack_message', text: 'Example decision', author: 'U123' }]);
  expect(result.warnings).toEqual([
    'Slack channel C123: only the first page was imported.',
    'Slack channel C456: could not read history. Check bot access and try again.',
  ]);
});
