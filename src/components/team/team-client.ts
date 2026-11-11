/**
 * team-client.ts — typed transport contract for the Team Sync panel.
 *
 * The panel is client-only and host-agnostic (Next.js dashboard, VS Code webview):
 * it never performs I/O itself. Hosts inject a `TeamSyncTransport` that maps a
 * typed request to a typed, runtime-validated response. Nothing here reads or
 * writes window/localStorage, and no credential (access token, publishable key)
 * is ever part of a response type — responses flow host → panel pre-redacted,
 * and `redactForHost` is provided for hosts that relay responses (e.g. via
 * postMessage) as defense in depth.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Actions + payloads (discriminated on `action`)
// ---------------------------------------------------------------------------

export type TeamSyncAction = 'configure' | 'preview' | 'sync' | 'status' | 'resolve';

/** How to reconcile a detected conflict. Backend may not support `resolve`. */
export type TeamSyncConflictChoice = 'keep_local' | 'use_incoming';

export interface TeamSyncConfigurePayload {
  action: 'configure';
  /** Supabase project URL, e.g. https://xyz.supabase.co */
  url: string;
  /** Public (anon/publishable) key. Not a secret, but never echoed back. */
  publishableKey: string;
  /** Personally authenticated session token. Secret: sent once, never stored, never echoed. */
  accessToken: string;
  /** Team/workspace identifier on the backend. */
  teamId: string;
}

export interface TeamSyncPreviewPayload {
  action: 'preview';
  /** Local workspace root, when the host knows one. Never treated as a secret. */
  projectRoot?: string;
}

export interface TeamSyncSyncPayload {
  action: 'sync';
  /** previewId from the immediately preceding successful `preview`. */
  previewId: string;
  projectRoot?: string;
  /** Opt-in: share committed-code analysis. Must default to false in the UI. */
  shareAnalysis: boolean;
  /** Per-run opt-in: only run ids the user explicitly checked, subset of preview eligibility. */
  sharedRunIds: string[];
  /** Literal true required. The UI must obtain an explicit per-operation confirmation. */
  confirm: true;
}

export interface TeamSyncStatusPayload {
  action: 'status';
  projectRoot?: string;
}

export interface TeamSyncResolvePayload {
  action: 'resolve';
  conflictId: string;
  choice: TeamSyncConflictChoice;
  projectRoot?: string;
}

export type TeamSyncRequest =
  | TeamSyncConfigurePayload
  | TeamSyncPreviewPayload
  | TeamSyncSyncPayload
  | TeamSyncStatusPayload
  | TeamSyncResolvePayload;

// ---------------------------------------------------------------------------
// Results (per action). None of these may carry credentials.
// ---------------------------------------------------------------------------

export interface TeamSyncConfigureResult {
  configured: boolean;
  /** Echo of the configured project URL (not a secret). */
  url: string | null;
  teamId: string | null;
  warnings: string[];
}

export interface TeamSyncPreviewManifestEntry {
  path: string;
  /** Short excerpt of what would be shared. Null when the backend withheld it. */
  excerpt: string | null;
  /** Backend flagged this path/excerpt as potentially sensitive. */
  sensitive: boolean;
  /** Why it was flagged, when given. */
  reason: string | null;
}

export interface TeamSyncPreviewRun {
  runId: string;
  label: string | null;
  itemCount: number;
  /** Only eligible runs may be selected for sharing. */
  eligible: boolean;
  ineligibleReason: string | null;
}

export interface TeamSyncPreviewResult {
  previewId: string;
  /**
   * Stable backend project key (the canonical identity of the project on the
   * team backend — NOT the local path). Null when the backend did not report one.
   */
  projectKey: string | null;
  /** Local root echoed back when the caller supplied one; null otherwise. */
  projectRoot: string | null;
  counts: {
    runs: number;
    eligibleRuns: number;
    items: number;
    artifacts: number;
    sensitivePaths: number;
    /** Incoming updates available from the team backend. */
    incomingRuns: number;
    incomingItems: number;
  };
  manifest: TeamSyncPreviewManifestEntry[];
  runs: TeamSyncPreviewRun[];
  generatedAt: string;
  warnings: string[];
}

export interface TeamSyncSyncResult {
  synced: boolean;
  previewId: string;
  projectKey: string | null;
  counts: {
    runsShared: number;
    itemsShared: number;
    incomingApplied: number;
    analysisShared: boolean;
  };
  sharedRunIds: string[];
  syncedAt: string;
  warnings: string[];
}

export interface TeamSyncConflictEntry {
  conflictId: string;
  summary: string;
  detectedAt: string;
  localLabel: string | null;
  incomingLabel: string | null;
}

export interface TeamSyncStatusResult {
  configured: boolean;
  url: string | null;
  teamId: string | null;
  projectKey: string | null;
  /** Local root echoed back when the caller supplied one; null otherwise. */
  projectRoot: string | null;
  pending: {
    /** Runs not yet shared. */
    outgoingRuns: number;
    incomingUpdates: number;
    conflicts: number;
  };
  /** Null when no sync has ever been recorded — the UI must say so, not guess. */
  lastSync: { at: string; ok: boolean; detail: string | null } | null;
  conflicts: TeamSyncConflictEntry[];
  capabilities: {
    resolve: boolean;
    incomingFetch: boolean;
  };
  warnings: string[];
}

export interface TeamSyncResolveResult {
  resolved: boolean;
  conflictId: string;
  choice: TeamSyncConflictChoice;
  projectKey: string | null;
  warnings: string[];
}

export interface TeamSyncResultMap {
  configure: TeamSyncConfigureResult;
  preview: TeamSyncPreviewResult;
  sync: TeamSyncSyncResult;
  status: TeamSyncStatusResult;
  resolve: TeamSyncResolveResult;
}

export type TeamSyncResult<A extends TeamSyncAction = TeamSyncAction> = TeamSyncResultMap[A];

// ---------------------------------------------------------------------------
// Response envelope + transport
// ---------------------------------------------------------------------------

export interface TeamSyncOk<A extends TeamSyncAction = TeamSyncAction> {
  ok: true;
  action: A;
  result: TeamSyncResult<A>;
}

export interface TeamSyncErr {
  ok: false;
  action: TeamSyncAction | 'unknown';
  /** Human-readable, credential-free message. */
  error: string;
  code?: string;
}

export type TeamSyncResponse<A extends TeamSyncAction = TeamSyncAction> = TeamSyncOk<A> | TeamSyncErr;

/**
 * The injectable transport. Hosts (dashboard page, VS Code webview bridge)
 * implement this; the panel only ever calls `request({ action, ...payload })`.
 */
export type TeamSyncActionRequest<A extends TeamSyncAction> = Extract<TeamSyncRequest, { action: A }>;

export type TeamSyncTransport = <A extends TeamSyncAction>(
  request: TeamSyncActionRequest<A>,
) => Promise<TeamSyncResponse<A>>;

// ---------------------------------------------------------------------------
// Runtime validation (zod mirrors of the types above)
// ---------------------------------------------------------------------------

const isoDate = z.string().min(1);
const nonEmptyString = z.string().min(1);
const warningList = z.array(z.string());

export const teamSyncPayloadSchemas = {
  configure: z.object({
    action: z.literal('configure'),
    url: z.string().url(),
    publishableKey: nonEmptyString,
    accessToken: nonEmptyString,
    teamId: nonEmptyString,
  }),
  preview: z.object({
    action: z.literal('preview'),
    projectRoot: z.string().min(1).optional(),
  }),
  sync: z
    .object({
      action: z.literal('sync'),
      previewId: nonEmptyString,
      projectRoot: z.string().min(1).optional(),
      shareAnalysis: z.boolean(),
      sharedRunIds: z.array(nonEmptyString),
      confirm: z.literal(true),
    })
    .refine(payload => payload.confirm === true, { message: 'sync requires explicit confirm: true' }),
  status: z.object({
    action: z.literal('status'),
    projectRoot: z.string().min(1).optional(),
  }),
  resolve: z.object({
    action: z.literal('resolve'),
    conflictId: nonEmptyString,
    choice: z.enum(['keep_local', 'use_incoming']),
    projectRoot: z.string().min(1).optional(),
  }),
} as const;

const configureResultSchema = z.object({
  configured: z.boolean(),
  url: z.string().nullable(),
  teamId: z.string().nullable(),
  warnings: warningList,
});

const manifestEntrySchema = z.object({
  path: z.string(),
  excerpt: z.string().nullable(),
  sensitive: z.boolean(),
  reason: z.string().nullable(),
});

const previewRunSchema = z.object({
  runId: nonEmptyString,
  label: z.string().nullable(),
  itemCount: z.number().int().nonnegative(),
  eligible: z.boolean(),
  ineligibleReason: z.string().nullable(),
});

const previewResultSchema = z.object({
  previewId: nonEmptyString,
  projectKey: z.string().nullable(),
  projectRoot: z.string().nullable(),
  counts: z.object({
    runs: z.number().int().nonnegative(),
    eligibleRuns: z.number().int().nonnegative(),
    items: z.number().int().nonnegative(),
    artifacts: z.number().int().nonnegative(),
    sensitivePaths: z.number().int().nonnegative(),
    incomingRuns: z.number().int().nonnegative(),
    incomingItems: z.number().int().nonnegative(),
  }),
  manifest: z.array(manifestEntrySchema),
  runs: z.array(previewRunSchema),
  generatedAt: isoDate,
  warnings: warningList,
});

const syncResultSchema = z.object({
  synced: z.boolean(),
  previewId: nonEmptyString,
  projectKey: z.string().nullable(),
  counts: z.object({
    runsShared: z.number().int().nonnegative(),
    itemsShared: z.number().int().nonnegative(),
    incomingApplied: z.number().int().nonnegative(),
    analysisShared: z.boolean(),
  }),
  sharedRunIds: z.array(nonEmptyString),
  syncedAt: isoDate,
  warnings: warningList,
});

const conflictEntrySchema = z.object({
  conflictId: nonEmptyString,
  summary: z.string(),
  detectedAt: isoDate,
  localLabel: z.string().nullable(),
  incomingLabel: z.string().nullable(),
});

const statusResultSchema = z.object({
  configured: z.boolean(),
  url: z.string().nullable(),
  teamId: z.string().nullable(),
  projectKey: z.string().nullable(),
  projectRoot: z.string().nullable(),
  pending: z.object({
    outgoingRuns: z.number().int().nonnegative(),
    incomingUpdates: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
  }),
  lastSync: z
    .object({ at: isoDate, ok: z.boolean(), detail: z.string().nullable() })
    .nullable(),
  conflicts: z.array(conflictEntrySchema),
  capabilities: z.object({
    resolve: z.boolean(),
    incomingFetch: z.boolean(),
  }),
  warnings: warningList,
});

const resolveResultSchema = z.object({
  resolved: z.boolean(),
  conflictId: nonEmptyString,
  choice: z.enum(['keep_local', 'use_incoming']),
  projectKey: z.string().nullable(),
  warnings: warningList,
});

export const teamSyncResultSchemas = {
  configure: configureResultSchema,
  preview: previewResultSchema,
  sync: syncResultSchema,
  status: statusResultSchema,
  resolve: resolveResultSchema,
} as const;

/** Validates an outgoing request against the contract before it leaves the panel. */
export function validateTeamSyncRequest(request: TeamSyncRequest): { ok: true } | { ok: false; error: string } {
  const schema = teamSyncPayloadSchemas[request.action];
  if (!schema) return { ok: false, error: `Unsupported action: ${String((request as { action?: unknown }).action)}` };
  const parsed = schema.safeParse(request);
  return parsed.success ? { ok: true } : { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request payload' };
}

/**
 * Runtime-validates an arbitrary transport answer into a typed response.
 * Invalid shapes become `{ ok: false }` errors — the UI never renders
 * unverified backend data and never fabricates values for missing fields.
 */
export function parseTeamSyncResponse(action: TeamSyncAction, raw: unknown): TeamSyncResponse {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, action, error: 'Malformed response: not an object' };
  }
  const envelope = raw as { ok?: unknown; error?: unknown; code?: unknown; result?: unknown };
  if (envelope.ok === false) {
    const error = typeof envelope.error === 'string' && envelope.error.trim().length > 0
      ? envelope.error
      : 'Backend reported a failure without a message';
    return {
      ok: false,
      action: 'unknown',
      error: redactSecretLikeStrings(error),
      code: typeof envelope.code === 'string' ? envelope.code : undefined,
    };
  }
  const parsed = teamSyncResultSchemas[action].safeParse(envelope.result);
  if (!parsed.success) {
    return { ok: false, action, error: `Malformed ${action} response from backend` };
  }
  return { ok: true, action, result: parsed.data as TeamSyncResult<typeof action> };
}

// ---------------------------------------------------------------------------
// Secret hygiene helpers
// ---------------------------------------------------------------------------

const SECRET_KEY_PATTERN = /(token|secret|password|publishablekey|apikey|accesskey)/i;

/**
 * Deep-clones a value and strips any credential-like keys. Hosts that relay
 * panel traffic (postMessage bridges, VS Code webviews) should pipe every
 * response through this before it reaches the renderer.
 */
export function redactForHost<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => redactForHost(item)) as unknown as T;
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? null : redactForHost(entry);
    }
    return out as unknown as T;
  }
  return value;
}

/** Replaces any occurrence of the given secret values in free text. */
export function redactSecretLikeStrings(text: string, secrets: string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Default HTTP transport (opt-in; hosts without an HTTP endpoint inject their own)
// ---------------------------------------------------------------------------

export interface HttpTransportOptions {
  /**
   * e.g. '/api/team-sync' (the web dashboard route, POST + JSON envelope).
   * The panel passes its `endpoint` prop here; hosts may override.
   */
  endpoint: string;
  fetchImpl?: typeof fetch;
  /** Abort the request after this many ms (default 30000). */
  timeoutMs?: number;
}

/**
 * Default JSON transport for hosts with an HTTP surface (web dashboard):
 * POST { action, ...payload } to the endpoint and expect the TeamSyncResponse
 * envelope. Sends the required `X-Rev-Request: 1` marker header. It adds no
 * credentials of its own; the backend sees only what the panel put in the
 * payload. VS Code hosts keep their own postMessage adapter instead.
 */
export function createHttpTeamSyncTransport(options: HttpTransportOptions): TeamSyncTransport {
  const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!doFetch) {
    return async request => ({
      ok: false,
      action: request.action,
      error: 'No fetch implementation available in this host',
    });
  }
  return async request => {
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer = controller && options.timeoutMs
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : undefined;
    try {
      const response = await doFetch(options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Rev-Request': '1' },
        body: JSON.stringify(request),
        signal: controller?.signal,
      });
      const text = await response.text();
      let raw: unknown;
      try {
        raw = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        return { ok: false, action: request.action, error: `Malformed JSON from backend (HTTP ${response.status})` };
      }
      if (!response.ok && (raw === null || typeof raw !== 'object' || (raw as { ok?: unknown }).ok === undefined)) {
        return { ok: false, action: request.action, error: `Backend request failed (HTTP ${response.status})` };
      }
      return parseTeamSyncResponse(request.action, raw) as TeamSyncResponse<typeof request.action>;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transport failure';
      return { ok: false, action: request.action, error: redactSecretLikeStrings(message) };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
