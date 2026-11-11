/**
 * Shared contract between the ReV VS Code extension host and the embedded
 * team sync webview. Deliberately free of node/vscode imports so it can be
 * bundled into the browser webview bundle and unit-tested in plain vitest.
 */

export const TEAM_ACTIONS = ['status', 'configure', 'preview', 'sync', 'resolve'] as const;
export type TeamAction = (typeof TEAM_ACTIONS)[number];

/** Actions whose daemon payloads are scoped to the active workspace root. */
export const TEAM_PROJECT_SCOPED_ACTIONS: readonly TeamAction[] = ['status', 'preview', 'sync', 'resolve'];

/** Bounded correlation-id contract for webview -> host messages. */
export const TEAM_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
export const TEAM_MAX_PAYLOAD_JSON_CHARS = 64 * 1024;

export const TEAM_REQUEST_MESSAGE_TYPE = 'TEAM_REQUEST' as const;
export const TEAM_RESPONSE_MESSAGE_TYPE = 'TEAM_RESPONSE' as const;

/** Single finalized daemon endpoint; every action routes through it. */
export const TEAM_DAEMON_ROUTE = '/v1/team-sync' as const;

export interface TeamRequestMessage {
  type: typeof TEAM_REQUEST_MESSAGE_TYPE;
  id: string;
  action: TeamAction;
  /** Request fields minus `action`; forwarded as the daemon `payload` object. */
  payload?: Record<string, unknown>;
}

export interface TeamResponseMessage {
  type: typeof TEAM_RESPONSE_MESSAGE_TYPE;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export function isTeamAction(value: unknown): value is TeamAction {
  return typeof value === 'string' && (TEAM_ACTIONS as readonly string[]).includes(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Request object the shared panel passes to the transport: {action, ...payload}.
 */
export type TeamSyncRequestObject = { action: TeamAction } & Record<string, unknown>;

/**
 * Envelope returned to the shared panel: {ok:true,action,result} |
 * {ok:false,action,error}. Matches team-client.ts's TeamSyncResponse shape.
 */
export type TeamSyncEnvelope =
  | { ok: true; action: TeamAction; result: unknown }
  | { ok: false; action: TeamAction; error: string };

/**
 * Mirrors `TeamSyncTransport` from src/components/team/team-client.ts: a
 * generic FUNCTION taking one request object {action, ...} and returning the
 * typed envelope. Never throws — failures arrive as {ok:false, action, error}.
 */
export type TeamSyncTransport = (request: TeamSyncRequestObject) => Promise<TeamSyncEnvelope>;
