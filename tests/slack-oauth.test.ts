import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { beginSlackOAuth, finishSlackOAuth, readSlackConnection } from '@/lib/server/slack';
import { importSlackChannels } from '@/lib/server/sources';

it('connects Slack once and fetches history only for selected member channels', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rev-slack-test-'));
  vi.stubEnv('REV_DATA_DIR', dir);
  vi.stubEnv('REV_SLACK_CLIENT_ID', '123.456');
  const request = vi.fn(async (url: string, options: RequestInit) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname.endsWith('/oauth.v2.access')) {
      expect((options.body as URLSearchParams).get('code')).toBe('one-time-code');
      return Response.json({ ok: true, team: { id: 'T123', name: 'Test workspace' }, authed_user: { access_token: 'test-user-token' } });
    }
    expect(options.headers).toMatchObject({ Authorization: 'Bearer test-user-token' });
    if (pathname.endsWith('/users.conversations')) {
      return Response.json({ ok: true, channels: [{ id: 'C123', name: 'project' }, { id: 'C456', name: 'other' }] });
    }
    expect(searchParams.get('channel')).toBe('C123');
    return Response.json({ ok: true, messages: [{ ts: '1760000000.123456', text: 'Project decision' }] });
  });
  vi.stubGlobal('fetch', request);

  try {
    const auth = beginSlackOAuth();
    const params = new URL(auth.url).searchParams;
    const [state, verifier] = auth.cookie.split('.');
    expect(params.get('state')).toBe(state);
    expect(params.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    await expect(finishSlackOAuth('one-time-code', 'wrong-state', auth.cookie)).rejects.toThrow('expired');
    expect(request).not.toHaveBeenCalled();

    await finishSlackOAuth('one-time-code', state, auth.cookie);
    expect(await readSlackConnection()).toMatchObject({ workspaceId: 'T123', workspace: 'Test workspace' });
    await expect(importSlackChannels(['C999'])).rejects.toThrow('no longer available');
    const imported = await importSlackChannels(['C123']);
    expect(imported.artifacts).toMatchObject([{ externalId: 'T123:C123:1760000000.123456', text: 'Project decision' }]);
    expect(request.mock.calls.filter(([url]) => url.includes('conversations.history'))).toHaveLength(1);
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  }
});
