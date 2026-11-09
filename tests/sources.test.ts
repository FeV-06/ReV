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
    const result = await importLocalGit();
    expect(result.artifacts).toMatchObject([{ kind: 'git_commit', author: 'example-author', text: 'Record a decision', paths: ['billing/retry.ts'] }]);
    expect(result.warnings).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
