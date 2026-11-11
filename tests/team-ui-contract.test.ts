import { describe, expect, it, vi } from 'vitest';
import {
  createHttpTeamSyncTransport,
  parseTeamSyncResponse,
  redactForHost,
  redactSecretLikeStrings,
  validateTeamSyncRequest,
  type TeamSyncStatusResult,
  type TeamSyncTransport,
} from '@/components/team/team-client';

const validStatus: TeamSyncStatusResult = {
  configured: false,
  url: null,
  teamId: null,
  projectKey: 'team-alpha/backend-key',
  projectRoot: null,
  pending: { outgoingRuns: 2, incomingUpdates: 1, conflicts: 0 },
  lastSync: null,
  conflicts: [],
  capabilities: { resolve: false, incomingFetch: true },
  warnings: [],
};

describe('team sync request validation', () => {
  it('accepts a fully-formed configure request', () => {
    const result = validateTeamSyncRequest({
      action: 'configure',
      url: 'https://example.supabase.co',
      publishableKey: 'pk',
      accessToken: 'tok',
      teamId: 'team-1',
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects configure with a non-URL', () => {
    const result = validateTeamSyncRequest({
      action: 'configure',
      url: 'not-a-url',
      publishableKey: 'pk',
      accessToken: 'tok',
      teamId: 'team-1',
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a valid sync request with confirm true', () => {
    const result = validateTeamSyncRequest({
      action: 'sync',
      previewId: 'p1',
      shareAnalysis: false,
      sharedRunIds: ['run-a'],
      confirm: true,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects sync without explicit confirm:true', () => {
    const result = validateTeamSyncRequest({
      action: 'sync',
      previewId: 'p1',
      shareAnalysis: false,
      sharedRunIds: [],
      confirm: false,
    } as unknown as Parameters<typeof validateTeamSyncRequest>[0]);
    expect(result.ok).toBe(false);
  });

  it('rejects unknown actions', () => {
    const result = validateTeamSyncRequest({ action: 'upload-everything' } as never);
    expect(result.ok).toBe(false);
  });
});

describe('team sync response parsing', () => {
  it('validates a well-formed status envelope', () => {
    const parsed = parseTeamSyncResponse('status', { ok: true, action: 'status', result: validStatus });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.result.projectKey).toBe('team-alpha/backend-key');
  });

  it('converts an ok:false envelope into an error without throwing', () => {
    const parsed = parseTeamSyncResponse('status', { ok: false, error: 'backend exploded' });
    expect(parsed).toEqual({ ok: false, action: 'unknown', error: 'backend exploded' });
  });

  it('rejects results missing required fields (no fabricated defaults)', () => {
    const incomplete = { ...validStatus } as Record<string, unknown>;
    delete incomplete.pending;
    const parsed = parseTeamSyncResponse('status', { ok: true, action: 'status', result: incomplete });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('Malformed status');
  });

  it('rejects non-object responses', () => {
    expect(parseTeamSyncResponse('status', 'nonsense').ok).toBe(false);
    expect(parseTeamSyncResponse('status', null).ok).toBe(false);
  });
});

describe('secret hygiene helpers', () => {
  it('strips credential-like keys recursively', () => {
    const redacted = redactForHost({
      accessToken: 'secret-token',
      nested: { apiKey: 'k', keep: 'visible' },
      list: [{ password: 'p', ok: 1 }],
    });
    expect(redacted).toEqual({
      accessToken: null,
      nested: { apiKey: null, keep: 'visible' },
      list: [{ password: null, ok: 1 }],
    });
  });

  it('removes known secret values from free text', () => {
    const out = redactSecretLikeStrings('failed for token abc123def and retry', ['abc123def']);
    expect(out).toBe('failed for token [redacted] and retry');
  });
});

describe('default HTTP transport', () => {
  it('POSTs to /api/team-sync with the X-Rev-Request marker and parses the envelope', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Response(JSON.stringify({ ok: true, action: 'status', result: validStatus }), { status: 200 }),
    );
    const transport = createHttpTeamSyncTransport({
      endpoint: '/api/team-sync',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const response = await transport({ action: 'status' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/team-sync', expect.objectContaining({ method: 'POST' }));
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Rev-Request']).toBe('1');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(response.ok).toBe(true);
  });

  it('reports malformed JSON instead of throwing', async () => {
    const transport = createHttpTeamSyncTransport({
      endpoint: '/api/team-sync',
      fetchImpl: (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch,
    });
    const response = await transport({ action: 'status' });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toContain('Malformed');
  });

  it('maps non-envelope HTTP failures to a plain error', async () => {
    const transport = createHttpTeamSyncTransport({
      endpoint: '/api/team-sync',
      fetchImpl: (async () => new Response('gateway down', { status: 502 })) as unknown as typeof fetch,
    });
    const response = await transport({ action: 'status' });
    expect(response).toMatchObject({ ok: false, error: expect.stringContaining('502') });
  });
});

describe('transport shape', () => {
  it('satisfies the generic function-shape contract (request object in, typed envelope out)', async () => {
    const transport: TeamSyncTransport = async request => {
      if (request.action === 'status') {
        return { ok: true, action: 'status', result: validStatus } as const;
      }
      return { ok: false, action: request.action, error: 'unimplemented' };
    };
    const response = await transport({ action: 'status' });
    expect(response.ok).toBe(true);
  });
});
