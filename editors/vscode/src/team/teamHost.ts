import { normalizePath } from '../daemonClient';
import {
  isPlainObject,
  isTeamAction,
  TEAM_ACTIONS,
  TEAM_DAEMON_ROUTE,
  TEAM_MAX_PAYLOAD_JSON_CHARS,
  TEAM_MESSAGE_ID_PATTERN,
  TEAM_PROJECT_SCOPED_ACTIONS,
  TEAM_RESPONSE_MESSAGE_TYPE,
  type TeamAction,
  type TeamResponseMessage,
} from './types';

export interface TeamDaemonCaller {
  (route: string, options: { method?: string; body?: unknown; workspaceRoot?: string }): Promise<unknown>;
}

export interface TeamRequestHandlerDeps {
  callDaemon: TeamDaemonCaller;
  getWorkspacePath(): string | undefined;
}

export type TeamPayloadParse = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

export function parseTeamPayload(raw: unknown): TeamPayloadParse {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (!isPlainObject(raw)) return { ok: false, error: 'team request payload must be a JSON object' };
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return { ok: false, error: 'team request payload is not JSON-serializable' };
  }
  if (serialized.length > TEAM_MAX_PAYLOAD_JSON_CHARS) {
    return { ok: false, error: `team request payload exceeds ${TEAM_MAX_PAYLOAD_JSON_CHARS} characters` };
  }
  return { ok: true, value: raw as Record<string, unknown> };
}

export interface TeamRoutePlan {
  route: '/v1/team-sync';
  method: 'POST';
  body: { action: TeamAction; payload: Record<string, unknown> };
  workspaceRoot?: string;
}

/**
 * Builds the single finalized daemon call: POST /v1/team-sync with body
 * {action, payload}. Project-scoped actions always carry the host-pinned
 * workspace root inside the payload; `configure` never forwards a
 * webview-supplied projectRoot.
 */
export function describeTeamRoute(
  action: TeamAction,
  workspacePath: string | undefined,
  payload: Record<string, unknown>
): TeamRoutePlan {
  const scoped = { ...payload };
  if (action === 'configure') {
    delete scoped.projectRoot;
  } else if (workspacePath !== undefined) {
    scoped.projectRoot = workspacePath;
  }
  return {
    route: TEAM_DAEMON_ROUTE,
    method: 'POST',
    body: { action, payload: scoped },
    workspaceRoot: workspacePath,
  };
}

/**
 * Response keys that must never be relayed back into the webview. The panel
 * contract keeps credentials out of every result type; this is defense in
 * depth so a daemon regression cannot leak tokens into the webview.
 */
const SECRET_RESPONSE_KEYS = new Set([
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'publishableKey',
  'publishable_key',
]);

export function stripSecretFields(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (Array.isArray(value)) return value.map(item => stripSecretFields(item, depth + 1));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_RESPONSE_KEYS.has(key)) continue;
      out[key] = stripSecretFields(child, depth + 1);
    }
    return out;
  }
  return value;
}

function errorResponse(id: string, error: string): TeamResponseMessage {
  return { type: TEAM_RESPONSE_MESSAGE_TYPE, id, ok: false, error };
}

/**
 * Host-side handler for a raw webview message. Validates the bounded
 * correlation id, the action allowlist, and the payload envelope; pins the
 * active workspace root on project-scoped operations; rejects webview-supplied
 * mismatched roots. Never exposes daemon tokens and never persists secrets.
 */
export async function handleTeamRequest(deps: TeamRequestHandlerDeps, raw: unknown): Promise<TeamResponseMessage> {
  const rawMsg = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawId = typeof rawMsg.id === 'string' ? rawMsg.id.slice(0, 64) : 'invalid';
  if (typeof rawMsg.id !== 'string' || !TEAM_MESSAGE_ID_PATTERN.test(rawMsg.id)) {
    return errorResponse(rawId, 'team request rejected: invalid correlation id');
  }
  const id = rawMsg.id;

  if (!isTeamAction(rawMsg.action)) {
    return errorResponse(id, `team request rejected: unknown action (allowed: ${TEAM_ACTIONS.join(', ')})`);
  }
  const action = rawMsg.action;

  const payloadParse = parseTeamPayload(rawMsg.payload);
  if (!payloadParse.ok) return errorResponse(id, `team request rejected: ${payloadParse.error}`);
  let payload = payloadParse.value;

  const ws = deps.getWorkspacePath();
  const projectScoped = (TEAM_PROJECT_SCOPED_ACTIONS as readonly string[]).includes(action);
  if (projectScoped) {
    if (!ws) return errorResponse(id, 'team request rejected: no active workspace folder is open');
    const supplied = payload.projectRoot;
    if (supplied !== undefined) {
      if (typeof supplied !== 'string' || normalizePath(supplied) !== normalizePath(ws)) {
        return errorResponse(id, 'team request rejected: webview-supplied projectRoot does not match the active workspace');
      }
    }
    payload = { ...payload, projectRoot: ws };
  }

  try {
    const plan = describeTeamRoute(action, ws, payload);
    const rawResult = await deps.callDaemon(plan.route, {
      method: plan.method,
      body: plan.body,
      workspaceRoot: plan.workspaceRoot,
    });
    // The daemon returns the action envelope; unwrap result for the webview so
    // the shared panel sees exactly the contract shape it validates.
    const envelope = isPlainObject(rawResult) ? rawResult : {};
    if (envelope.ok === false) {
      return errorResponse(id, typeof envelope.error === 'string' ? envelope.error : 'team sync failed at the daemon');
    }
    const result = envelope.ok === true ? envelope.result : rawResult;
    return { type: TEAM_RESPONSE_MESSAGE_TYPE, id, ok: true, result: stripSecretFields(result) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(id, message);
  }
}

export function createTeamRequestHandler(
  deps: TeamRequestHandlerDeps
): (raw: unknown) => Promise<TeamResponseMessage> {
  return (raw: unknown) => handleTeamRequest(deps, raw);
}
