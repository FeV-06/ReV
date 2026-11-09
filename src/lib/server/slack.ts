import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { readJsonLimited } from './body';

export const slackOrigin = 'http://localhost:3077';
export const slackCallback = `${slackOrigin}/api/slack/callback`;
export const slackCookie = 'rev_slack_oauth';
export const slackChannelId = z.string().regex(/^[CG][A-Z0-9]{1,39}$/);
const scopes = 'channels:read,channels:history,groups:read,groups:history';

const connectionSchema = z.object({
  token: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  workspace: z.string(),
  workspaceId: z.string(),
});
type Connection = z.infer<typeof connectionSchema>;
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive().optional(),
});

function connectionPath() {
  return join(resolve(/*turbopackIgnore: true*/ process.env.REV_DATA_DIR || '.rev-data'), 'slack-connection.json');
}

export async function readSlackConnection() {
  try {
    return connectionSchema.parse(JSON.parse(await readFile(connectionPath(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('Could not read the local Slack connection.');
  }
}

async function save(connection: Connection) {
  const file = connectionPath();
  const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  await mkdir(resolve(file, '..'), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temp, JSON.stringify(connection), { mode: 0o600, flag: 'wx' });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

export async function slackApi(method: string, options: RequestInit) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    ...options, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Slack request failed (HTTP ${response.status}).`);
  }
  const data = await readJsonLimited(response, 1_000_000);
  const status = z.object({ ok: z.boolean(), error: z.string().regex(/^[a-z_]+$/).optional() }).parse(data);
  if (!status.ok) throw new Error(`Slack request failed (${status.error ?? 'unknown_error'}).`);
  return data;
}

export function beginSlackOAuth() {
  const clientId = process.env.REV_SLACK_CLIENT_ID;
  if (!clientId) throw new Error('Add REV_SLACK_CLIENT_ID to .env.local to enable Slack sign-in.');
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.search = new URLSearchParams({
    client_id: clientId, scope: '', user_scope: scopes, redirect_uri: slackCallback, state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  }).toString();
  return { url: url.toString(), cookie: `${state}.${verifier}` };
}

export async function finishSlackOAuth(code: string, state: string, cookie: string) {
  const [expected, verifier] = cookie.split('.');
  const clientId = process.env.REV_SLACK_CLIENT_ID;
  if (!clientId || !code || !state || state !== expected || !verifier) throw new Error('Slack sign-in expired. Try again.');
  const result = z.object({
    team: z.object({ id: z.string(), name: z.string() }),
    authed_user: tokenSchema,
  }).parse(await slackApi('oauth.v2.access', { method: 'POST', body: new URLSearchParams({
    client_id: clientId, code, code_verifier: verifier, redirect_uri: slackCallback,
  }) }));
  await save(withToken({ workspace: result.team.name, workspaceId: result.team.id }, result.authed_user));
}

function withToken(workspace: Pick<Connection, 'workspace' | 'workspaceId'>, token: z.infer<typeof tokenSchema>): Connection {
  return {
    workspace: workspace.workspace, workspaceId: workspace.workspaceId,
    token: token.access_token, refreshToken: token.refresh_token,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
  };
}

let refresh: Promise<Connection> | undefined;
export async function activeSlackConnection() {
  const connection = await readSlackConnection();
  if (!connection || !connection.expiresAt || connection.expiresAt > Date.now() + 60_000) return connection;
  const clientId = process.env.REV_SLACK_CLIENT_ID;
  if (!connection.refreshToken || !clientId) throw new Error('Reconnect Slack to renew workspace access.');
  refresh ??= (async () => {
    const data = await slackApi('oauth.v2.access', { method: 'POST', body: new URLSearchParams({
      client_id: clientId, grant_type: 'refresh_token', refresh_token: connection.refreshToken!,
    }) });
    const updated = withToken(connection, tokenSchema.parse(data));
    await save(updated);
    return updated;
  })().finally(() => { refresh = undefined; });
  return refresh;
}

export async function listSlackChannels(token: string) {
  const channels = new Map<string, { id: string; name: string }>();
  let cursor = '';
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200' });
    if (cursor) params.set('cursor', cursor);
    const result = z.object({
      channels: z.array(z.object({ id: slackChannelId, name: z.string() })),
      response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
    }).parse(await slackApi(`users.conversations?${params}`, { headers: { Authorization: `Bearer ${token}` } }));
    for (const channel of result.channels) channels.set(channel.id, channel);
    cursor = result.response_metadata?.next_cursor ?? '';
    if (!cursor) break;
  }
  return [...channels.values()].sort((a, b) => a.name.localeCompare(b.name));
}
