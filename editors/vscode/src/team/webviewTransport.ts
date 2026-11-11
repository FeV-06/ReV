import {
  TEAM_MESSAGE_ID_PATTERN,
  TEAM_REQUEST_MESSAGE_TYPE,
  TEAM_RESPONSE_MESSAGE_TYPE,
  type TeamAction,
  type TeamRequestMessage,
  type TeamResponseMessage,
} from './types';
import type {
  TeamSyncAction,
  TeamSyncActionRequest,
  TeamSyncResponse,
} from '../../../../src/components/team/team-client';

/** Slightly above the daemon client's 180s fetch AbortSignal so daemon errors surface first. */
export const TEAM_REQUEST_TIMEOUT_MS = 185_000;

export interface TeamHostBridge {
  postMessage(message: unknown): unknown;
}

export interface TeamMessageEventLike {
  data?: unknown;
}

export interface TeamEventTargetLike {
  addEventListener(type: 'message', listener: (event: TeamMessageEventLike) => void): void;
  removeEventListener(type: 'message', listener: (event: TeamMessageEventLike) => void): void;
}

/**
 * Webview-side `TeamSyncTransport` — the exact generic function contract from
 * team-client.ts — plus lifecycle introspection for tests and the entry point.
 */
export interface WebviewTeamTransport {
  <A extends TeamSyncAction>(request: TeamSyncActionRequest<A>): Promise<TeamSyncResponse<A>>;
  /** Number of requests still awaiting a host response. */
  pendingCount(): number;
  /** Resolves all pending requests with an error envelope and detaches listeners. */
  dispose(): void;
}

export interface WebviewTransportOptions {
  /** Defaults to the webview `window` when available (tests inject a fake). */
  eventTarget?: TeamEventTargetLike;
  timeoutMs?: number;
  nextRandom?: () => string;
}

interface PendingEntry {
  action: TeamSyncAction;
  resolve: (envelope: TeamSyncResponse<TeamSyncAction>) => void;
  timer: ReturnType<typeof setTimeout>;
}

function defaultRandom(): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID().replace(/-/g, '').slice(0, 12);
  return Math.random().toString(36).slice(2, 12).padEnd(12, '0');
}

function errEnvelope(action: TeamSyncAction, error: string): TeamSyncResponse<TeamSyncAction> {
  return { ok: false, action, error };
}

const KNOWN_ACTIONS: readonly string[] = ['status', 'configure', 'preview', 'sync', 'resolve'];

/**
 * Browser-side implementation of the shared `TeamSyncTransport` function
 * contract (team-client.ts): takes one request object `{ action, ...payload }`,
 * resolves the typed envelope `{ok:true, action, result} | {ok:false, action,
 * error}` and never throws. Each request carries a bounded unique correlation
 * id; the extension host replies with TEAM_RESPONSE envelopes correlated by id.
 */
export function createWebviewTeamTransport(
  bridge: TeamHostBridge,
  options: WebviewTransportOptions = {}
): WebviewTeamTransport {
  const fallbackTarget = typeof window !== 'undefined' ? (window as unknown as TeamEventTargetLike) : undefined;
  const eventTarget = options.eventTarget ?? fallbackTarget;
  const timeoutMs = options.timeoutMs ?? TEAM_REQUEST_TIMEOUT_MS;
  const nextRandom = options.nextRandom ?? defaultRandom;
  const pending = new Map<string, PendingEntry>();
  let seq = 0;
  let disposed = false;

  const listener = (event: TeamMessageEventLike): void => {
    const msg = event?.data as Partial<TeamResponseMessage> | undefined;
    if (!msg || msg.type !== TEAM_RESPONSE_MESSAGE_TYPE || typeof msg.id !== 'string') return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok === true) {
      entry.resolve({ ok: true, action: entry.action, result: msg.result } as TeamSyncResponse<TeamSyncAction>);
    } else {
      entry.resolve(
        errEnvelope(
          entry.action,
          typeof msg.error === 'string' && msg.error ? msg.error : 'team request failed'
        )
      );
    }
  };

  eventTarget?.addEventListener('message', listener);

  function nextId(): string {
    seq += 1;
    return `rev-team-${seq.toString(36)}-${nextRandom()}`;
  }

  const transport = function teamTransport(
    request: TeamSyncActionRequest<TeamSyncAction>
  ): Promise<TeamSyncResponse<TeamSyncAction>> {
    const action = (request as { action?: unknown } | null | undefined)?.action;
    if (typeof action !== 'string' || !KNOWN_ACTIONS.includes(action)) {
      return Promise.resolve(errEnvelope('status', 'team transport requires a known action'));
    }
    const knownAction = action as TeamSyncAction;
    if (disposed) {
      return Promise.resolve(errEnvelope(knownAction, 'team transport is disposed'));
    }
    const id = nextId();
    if (!TEAM_MESSAGE_ID_PATTERN.test(id)) {
      return Promise.resolve(errEnvelope(knownAction, 'team transport generated an invalid correlation id'));
    }
    return new Promise<TeamSyncResponse<TeamSyncAction>>(resolve => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(errEnvelope(knownAction, `team request "${knownAction}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { action: knownAction, resolve, timer });
      const message: TeamRequestMessage = {
        type: TEAM_REQUEST_MESSAGE_TYPE,
        id,
        action: knownAction as TeamAction,
        payload: request as unknown as Record<string, unknown>,
      };
      bridge.postMessage(message);
    });
  } as unknown as WebviewTeamTransport;

  transport.pendingCount = () => pending.size;
  transport.dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve(errEnvelope(entry.action, 'team transport disposed before the request completed'));
    }
    pending.clear();
    eventTarget?.removeEventListener('message', listener);
  };

  return transport;
}
