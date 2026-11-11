/**
 * Isolated authorization tests for the ReV team Supabase schema + RPC API.
 *
 * Runs the two migration files against an in-memory PGlite database with a
 * minimal `auth` shim: an `auth.users` table plus `auth.uid()` sourced from
 * the `request.jwt.claims` GUC, mirroring the Supabase runtime contract.
 * Transaction-scoped SET ROLE + GUC simulate anon / member / leader JWT
 * contexts. No network, no real credentials, no project code is executed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = process.cwd();
const MIGRATION_FILES = [
  'supabase/migrations/0001_team_schema.sql',
  'supabase/migrations/0002_rpc_api.sql',
] as const;

const goodHandoverPayload = (overrides: Record<string, unknown> = {}) => ({
  status: 'approved',
  selectedIds: ['src-1', 'src-2'],
  artifacts: [
    { id: 'src-1', kind: 'committed_file' },
    { id: 'src-2', kind: 'committed_file' },
  ],
  sourceEvents: [{ id: 'ev-1', at: '2026-11-11T00:00:00Z' }],
  ...overrides,
});
const goodAnalysisPayload = (projectKey = 'a1b2c3d4e5') => ({
  version: 1,
  projectKey,
  analyzerVersion: '1.0.0',
  commit: 'deadbee',
  report: { files: 12, findings: [] },
});

let db: PGlite;

async function applyMigrations(): Promise<void> {
  for (const rel of MIGRATION_FILES) {
    const sql = await readFile(path.join(root, rel), 'utf8');
    await db.exec(sql);
  }
}

/** Create a fake Supabase auth user row (only id is used by the schema). */
async function createAuthUser(id: string): Promise<void> {
  await db.query('insert into auth.users (id) values ($1)', [id]);
}

/** Set transaction-scoped role + JWT claims; must run inside a transaction. */
async function act(role: 'anon' | 'authenticated', uid: string | null): Promise<void> {
  await db.query('select set_config($1, $2, true)', ['role', role]);
  await db.query(
    'select set_config($1, $2, true)',
    ['request.jwt.claims', JSON.stringify({ sub: uid })],
  );
}

/** Call an RPC using Postgres named arguments, matching PostgREST. */
async function rpcNamed(
  fn: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const keys = Object.keys(args);
  const placeholders = keys.map((key, i) => `"${key}" => $${i + 1}`).join(', ');
  const sql = keys.length
    ? `select * from public."${fn}"(${placeholders})`
    : `select * from public."${fn}"()`;
  const result = await db.query(sql, keys.map(k => args[k]));
  return result.rows as Record<string, unknown>[];
}

/**
 * Run one scenario inside its own transaction. Failing statements abort the
 * transaction, but ROLLBACK remains legal in an aborted block, so each
 * scenario is fully isolated even when it asserts on errors.
 */
async function scenario(fn: () => Promise<void>): Promise<void> {
  await db.query('begin');
  try {
    await fn();
  } finally {
    await db.query('rollback');
  }
}

/** Expect an RPC to fail; resolves with the failure message. */
async function rpcError(fn: string, args: Record<string, unknown>): Promise<string> {
  await db.query('savepoint expected_rpc_failure');
  try {
    await rpcNamed(fn, args);
  } catch (error) {
    await db.query('rollback to savepoint expected_rpc_failure');
    await db.query('release savepoint expected_rpc_failure');
    return error instanceof Error ? error.message : String(error);
  }
  await db.query('release savepoint expected_rpc_failure');
  throw new Error(`expected ${fn} to fail but it succeeded`);
}

/** Direct table SELECT as the current context (exercises RLS, not RPCs). */
async function selectWhere(
  table: string,
  whereSql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const result = await db.query(
    `select * from public."${table}" where ${whereSql}`,
    params,
  );
  return result.rows as Record<string, unknown>[];
}

/** Direct table INSERT as the current context (must fail: no DML grants). */
async function expectInsertDenied(table: string, insertSql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(insertSql, params);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`expected direct insert into ${table} to be denied`);
}

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
  // --- Supabase auth shim --------------------------------------------------
  // auth.users + auth.uid() over request.jwt.claims, like Supabase. PGlite
  // ships no pgcrypto, so the shim uses none — the migrations do not need it.
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
    create role authenticated nologin noinherit;
    create role anon nologin noinherit;
    grant usage on schema public to authenticated, anon;
  `);
  await applyMigrations();
  // Idempotency proof: re-run both migrations; nothing may break or drop.
  await applyMigrations();
}, 60_000);

afterAll(async () => {
  if (db) await db.close();
});

// ---------------------------------------------------------------------------
// Shared fixture state
// ---------------------------------------------------------------------------
interface Fixture {
  leader: string;
  member: string;
  outsider: string;
  otherLeader: string;
  teamA: string;
  teamB: string;
}

let fx: Fixture;

async function seedFixture(): Promise<void> {
  fx = {
    leader: randomUUID(),
    member: randomUUID(),
    outsider: randomUUID(),
    otherLeader: randomUUID(),
    teamA: randomUUID(),
    teamB: randomUUID(),
  };
  for (const u of [fx.leader, fx.member, fx.outsider, fx.otherLeader]) {
    await createAuthUser(u);
  }

  await db.query('begin');
  await act('authenticated', fx.leader);
  const [teamARow] = await rpcNamed('rev_create_team', { p_team_name: 'Team A' });
  await act('authenticated', fx.otherLeader);
  const [teamBRow] = await rpcNamed('rev_create_team', { p_team_name: 'Team B' });
  await act('authenticated', fx.leader);
  await rpcNamed('rev_invite_member', { p_team_id: teamARow.team_id, p_member_user_id: fx.member, p_member_role: 'member' });
  await db.query('commit');

  fx.teamA = teamARow.team_id as string;
  fx.teamB = teamBRow.team_id as string;
}

describe('migration applies twice without dropping data', () => {
  beforeEach(seedFixture);

  it('re-running both migrations preserves rows and RPCs', async () => {
    await scenario(async () => {
      await act('authenticated', fx.leader);
      await rpcNamed('rev_publish_document', {
        p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'analysis',
        p_doc_key: 'mig-1', p_expected_version: 0, p_payload: goodAnalysisPayload(),
      });
      await db.query('reset role');
      await applyMigrations(); // repeatable migration check
      await act('authenticated', fx.leader);
      const list = await rpcNamed('rev_list_documents', { p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5' });
      expect(list.some(r => r.doc_key === 'mig-1')).toBe(true);
    });
  });
});

describe('team creation and membership', () => {
  beforeEach(seedFixture);

  it('does not expose the security-definer chain owner helper to arbitrary authenticated users', async () => {
    await scenario(async () => {
      await act('authenticated', fx.outsider);
      await expect(rpcError('rev_chain_owner', { p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'handover', p_doc_key: 'guessed' }))
        .resolves.toMatch(/permission denied/i);
    });
  });

  it('leader creates team and becomes its single leader', async () => {
    await scenario(async () => {
      await act('authenticated', fx.leader);
      const rows = await selectWhere('rev_team_members', 'team_id = $1 and member_role = $2', [fx.teamA, 'leader']);
      expect(rows).toHaveLength(1);
      expect(rows[0].member_user_id).toBe(fx.leader);
    });
  });

  it('anonymous callers are rejected on RPC and table access', async () => {
    await scenario(async () => {
      await act('anon', null);
      await expect(rpcError('rev_create_team', { p_team_name: 'X' }))
        .resolves.toMatch(/rev_unauthenticated|permission denied/i);
    });
    await scenario(async () => {
      await act('anon', null);
      await expect(db.query('select * from public.rev_team_members'))
        .rejects.toThrow(/permission denied/i);
    });
    await scenario(async () => {
      await act('anon', null);
      await expect(db.query('select * from public.rev_documents'))
        .rejects.toThrow(/permission denied/i);
    });
  });

  it('non-leader cannot invite', async () => {
    await scenario(async () => {
      await act('authenticated', fx.member);
      await expect(rpcError('rev_invite_member', { p_team_id: fx.teamA, p_member_user_id: fx.outsider, p_member_role: 'member' }))
        .resolves.toMatch(/rev_forbidden_not_leader/);
    });
  });

  it('invites require a real auth.users id (no UUID guessing)', async () => {
    await scenario(async () => {
      const ghost = randomUUID(); // never registered
      await act('authenticated', fx.leader);
      await expect(rpcError('rev_invite_member', { p_team_id: fx.teamA, p_member_user_id: ghost, p_member_role: 'member' }))
        .resolves.toMatch(/rev_unknown_user/);
    });
  });

  it('invited member reads the roster; outsider cannot', async () => {
    await scenario(async () => {
      await act('authenticated', fx.member);
      const roster = await selectWhere('rev_team_members', 'team_id = $1', [fx.teamA]);
      expect(roster.map(r => r.member_user_id)).toContain(fx.member);
      expect(roster.map(r => r.member_user_id)).toContain(fx.leader);

      await act('authenticated', fx.outsider);
      const outside = await selectWhere('rev_team_members', 'team_id = $1', [fx.teamA]);
      expect(outside).toHaveLength(0);
    });
  });

  it('re-inviting an existing member is an idempotent no-op', async () => {
    await scenario(async () => {
      await act('authenticated', fx.leader);
      const again = await rpcNamed('rev_invite_member', { p_team_id: fx.teamA, p_member_user_id: fx.member, p_member_role: 'member' });
      expect(again).toHaveLength(1);
      expect(again[0].member_role).toBe('member');
    });
  });

  it('only the owner can mint a leader; exactly one leader exists', async () => {
    await scenario(async () => {
      await act('authenticated', fx.member);
      await expect(rpcError('rev_invite_member', { p_team_id: fx.teamA, p_member_user_id: fx.outsider, p_member_role: 'leader' }))
        .resolves.toMatch(/not_leader|only_owner/);

      await act('authenticated', fx.leader);
      await expect(rpcError('rev_invite_member', { p_team_id: fx.teamA, p_member_user_id: fx.outsider, p_member_role: 'leader' }))
        .resolves.toMatch(/leader/i);
      const leaders = await selectWhere('rev_team_members', 'team_id = $1 and member_role = $2', [fx.teamA, 'leader']);
      expect(leaders).toHaveLength(1);
      // A third leader is refused by the single-leader trigger.
      await expect(rpcError('rev_invite_member', { p_team_id: fx.teamA, p_member_user_id: fx.otherLeader, p_member_role: 'leader' }))
        .resolves.toMatch(/leader/i);
    });
  });
});

describe('publish + list authorization', () => {
  beforeEach(seedFixture);

  it('member publishes analysis and reads it back', async () => {
    await scenario(async () => {
      await act('authenticated', fx.member);
      const pub = await rpcNamed('rev_publish_document', {
        p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'analysis',
        p_doc_key: 'review-1', p_expected_version: 0, p_payload: goodAnalysisPayload(),
      });
      expect(pub[0].status).toBe('committed');
      expect(Number(pub[0].version)).toBe(1);
      const listed = await rpcNamed('rev_list_documents', { p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'analysis' });
      expect(listed).toHaveLength(1);
    });
  });

  it('outsider is blocked on publish, list, and RLS reads', async () => {
    await scenario(async () => {
      await act('authenticated', fx.outsider);
      const err = await rpcError('rev_publish_document', {
        p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'analysis',
        p_doc_key: 'x', p_expected_version: 0, p_payload: goodAnalysisPayload(),
      });
      expect(err).toMatch(/rev_forbidden_not_member/);
      expect(await rpcNamed('rev_list_documents', { p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5' })).toEqual([]);
      const rls = await selectWhere('rev_documents', 'team_id = $1', [fx.teamA]);
      expect(rls).toHaveLength(0);
    });
  });

  it('stale expected_version appends a conflict; both sides preserved; head is max committed', async () => {
    const docKey = 'analysis-1';
    await scenario(async () => {
      await act('authenticated', fx.leader);
      await rpcNamed('rev_publish_document', {
        p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'analysis',
        p_doc_key: docKey, p_expected_version: 0, p_payload: goodAnalysisPayload(),
      });
      await act('authenticated', fx.member);
      const ok = await rpcNamed('rev_publish_document', {
        p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'analysis',
        p_doc_key: docKey, p_expected_version: 1, p_payload: { ...goodAnalysisPayload(), report: { files: 13, findings: [] } },
      });
      expect(ok[0].status).toBe('committed');
      expect(Number(ok[0].version)).toBe(2);

      await act('authenticated', fx.leader);
      const stale = await rpcNamed('rev_publish_document', {
        p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'analysis',
        p_doc_key: docKey, p_expected_version: 1, p_payload: { ...goodAnalysisPayload(), report: { files: 14, findings: [] } },
      });
      expect(stale[0].status).toBe('conflict');
      expect(Number(stale[0].version)).toBe(3);

      const history = await rpcNamed('rev_list_documents', { p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'analysis' });
      expect(history).toHaveLength(3);
      const committed = history.filter(r => r.status === 'committed').map(r => Number(r.version));
      expect(committed).toEqual([2, 1]);
      expect(history.find(r => r.status === 'conflict')).toBeDefined();
    });
  });

  it('operation UUID replays the original result idempotently (single ledger entry)', async () => {
    await scenario(async () => {
      const op = randomUUID();
      await act('authenticated', fx.member);
      const first = await rpcNamed('rev_publish_document', {
        p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'analysis',
        p_doc_key: 'doc-op', p_expected_version: 0, p_payload: goodAnalysisPayload(),
        p_operation_id: op,
      });
      expect(first[0].status).toBe('committed');
      const retry = await rpcNamed('rev_publish_document', {
        p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'analysis',
        p_doc_key: 'doc-op', p_expected_version: 0, p_payload: goodAnalysisPayload(),
        p_operation_id: op,
      });
      expect(String(retry[0].document_id)).toBe(String(first[0].document_id));
      const ledger = await selectWhere('rev_sync_operations', 'operation_id = $1', [op]);
      expect(ledger).toHaveLength(1);
    });
  });

  it('rejects bad payloads per actual Run shapes; allows user-approved source text', async () => {
    await scenario(async () => {
      await act('authenticated', fx.member);
      const base = { p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_doc_key: 'k', p_expected_version: 0 };

      // Valid analysis passes.
      const ok = await rpcNamed('rev_publish_document', { ...base, p_doc_key: 'kind-ok', p_kind: 'analysis', p_payload: goodAnalysisPayload() });
      expect(ok[0].status).toBe('committed');

      // Handover shape fed to analysis kind → invalid.
      await expect(rpcError('rev_publish_document', { ...base, p_kind: 'analysis', p_payload: goodHandoverPayload() }))
        .resolves.toMatch(/rev_invalid_payload/);
      // Unknown kind.
      await expect(rpcError('rev_publish_document', { ...base, p_kind: 'other', p_payload: goodAnalysisPayload() }))
        .resolves.toMatch(/rev_invalid_kind/);
      // Analysis: wrong version, path-like projectKey, bad commit hash.
      await expect(rpcError('rev_publish_document', { ...base, p_kind: 'analysis', p_payload: { ...goodAnalysisPayload(), version: 2 } }))
        .resolves.toMatch(/rev_invalid_payload/);
      await expect(rpcError('rev_publish_document', { ...base, p_kind: 'analysis', p_payload: { ...goodAnalysisPayload(), projectKey: '../etc/passwd' } }))
        .resolves.toMatch(/rev_invalid_payload/);
      await expect(rpcError('rev_publish_document', { ...base, p_kind: 'analysis', p_payload: { ...goodAnalysisPayload(), commit: 'zzzz' } }))
        .resolves.toMatch(/rev_invalid_payload/);
      // Banned keys anywhere in the structure (server-side gate).
      await expect(rpcError('rev_publish_document', { ...base, p_kind: 'analysis', p_payload: { ...goodAnalysisPayload(), projectRoot: '/repo' } }))
        .resolves.toMatch(/rev_invalid_payload/);
      await expect(rpcError('rev_publish_document', { ...base, p_kind: 'analysis', p_payload: { ...goodAnalysisPayload(), report: { nested: { api_key: 'k' } } } }))
        .resolves.toMatch(/rev_invalid_payload/);
      // Oversized payload (> 2 MB).
      await expect(rpcError('rev_publish_document', { ...base, p_kind: 'analysis', p_payload: { ...goodAnalysisPayload(), report: { blob: 'x'.repeat(2_100_000) } } }))
        .resolves.toMatch(/rev_invalid_payload/);
      // project_key RPC arg must be a hash, never a path.
      await expect(rpcError('rev_publish_document', { ...base, p_project_key: '../etc/passwd', p_kind: 'analysis', p_payload: goodAnalysisPayload('../etc/passwd') }))
        .resolves.toMatch(/rev_invalid_project_key/);

      // User-approved source text may mention local paths — allowed.
      const approved = await rpcNamed('rev_publish_document', {
        ...base, p_doc_key: 'pathy-source', p_kind: 'analysis',
        p_payload: { ...goodAnalysisPayload(), report: { note: 'source text references /home/dev/project and C:\\temp as user-approved content' } },
      });
      expect(approved[0].status).toBe('committed');
    });
  });

  it('handover payload integrity: selected artifacts, working_change, sourceEvents refs', async () => {
    await scenario(async () => {
      await act('authenticated', fx.member);
      const base = { p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_doc_key: 'k', p_expected_version: 0, p_kind: 'handover' };

      // needs_review is a valid review status.
      const needsReview = await rpcNamed('rev_publish_document', {
        ...base, p_doc_key: 'ho-status', p_payload: goodHandoverPayload({ status: 'needs_review' }),
      });
      expect(needsReview[0].status).toBe('committed');

      // Unselected artifact id is rejected.
      await expect(rpcError('rev_publish_document', {
        ...base, p_doc_key: 'ho-unselected',
        p_payload: goodHandoverPayload({ selectedIds: ['src-1'] }),
      })).resolves.toMatch(/rev_invalid_payload/);

      // working_change artifact is rejected.
      await expect(rpcError('rev_publish_document', {
        ...base, p_doc_key: 'ho-working',
        p_payload: goodHandoverPayload({ artifacts: [{ id: 'src-1', kind: 'working_change' }] }),
      })).resolves.toMatch(/rev_invalid_payload/);

      // Dangling sourceEvents reference is rejected.
      await expect(rpcError('rev_publish_document', {
        ...base, p_doc_key: 'ho-dangling',
        p_payload: goodHandoverPayload({
          artifacts: [{ id: 'src-1', kind: 'committed_file', sourceEventIds: ['ev-missing'] }],
        }),
      })).resolves.toMatch(/rev_invalid_payload/);

      // Valid sourceEventIds reference passes.
      const withEvents = await rpcNamed('rev_publish_document', {
        ...base, p_doc_key: 'ho-events',
        p_payload: goodHandoverPayload({
          artifacts: [{ id: 'src-1', kind: 'committed_file', sourceEventIds: ['ev-1'] }],
        }),
      });
      expect(withEvents[0].status).toBe('committed');

      // Banned secret-ish keys in a handover are rejected.
      await expect(rpcError('rev_publish_document', {
        ...base, p_doc_key: 'ho-secret',
        p_payload: goodHandoverPayload({ restore_token: 'surprise' }),
      })).resolves.toMatch(/rev_invalid_payload/);
    });
  });

  it('direct table writes are denied even for members (RPC-only writes)', async () => {
    await scenario(async () => {
      await act('authenticated', fx.member);
      const err = await expectInsertDenied(
        'rev_documents',
        'insert into public.rev_documents (team_id, project_key, kind, doc_key, version, payload, operation_id) values ($1, $2, $3, $4, 1, $5::jsonb, gen_random_uuid())',
        [fx.teamA, 'a1b2c3d4e5', 'analysis', 'direct', JSON.stringify({ summary: 'bypass' })],
      );
      expect(err).toMatch(/permission denied/i);
    });
  });

  it('handovers are invisible to other members via RPC and RLS', async () => {
    const docKey = 'handover-1';
    await scenario(async () => {
      await act('authenticated', fx.leader);
      await rpcNamed('rev_publish_document', {
        p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'handover',
        p_doc_key: docKey, p_expected_version: 0, p_payload: goodHandoverPayload(),
      });

      await act('authenticated', fx.member);
      const viaRpc = await rpcNamed('rev_list_documents', { p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'handover' });
      expect(viaRpc.filter(r => r.doc_key === docKey)).toHaveLength(0);
      const viaRls = await selectWhere('rev_documents', 'team_id = $1 and kind = $2', [fx.teamA, 'handover']);
      expect(viaRls).toHaveLength(0);
    });
  });

  it('leader supersedes a member handover; original owner keeps access to all versions and can continue the chain', async () => {
    const docKey = 'ho-chain';
    await scenario(async () => {
      await act('authenticated', fx.member);
      const seed = await rpcNamed('rev_publish_document', {
        p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'handover',
        p_doc_key: docKey, p_expected_version: 0, p_payload: goodHandoverPayload(),
      });
      expect(seed[0].status).toBe('committed');

      await act('authenticated', fx.leader);
      const sup = await rpcNamed('rev_publish_document', {
        p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'handover',
        p_doc_key: docKey, p_expected_version: 1, p_payload: goodHandoverPayload(),
      });
      expect(sup[0].status).toBe('committed');

      await act('authenticated', fx.member);
      const history = await rpcNamed('rev_list_documents', { p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'handover' });
      const versions = history.filter(r => r.doc_key === docKey).map(r => Number(r.version)).sort();
      expect(versions).toEqual([1, 2]);
      const next = await rpcNamed('rev_publish_document', {
        p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'handover',
        p_doc_key: docKey, p_expected_version: 2, p_payload: goodHandoverPayload(),
      });
      expect(next[0].status).toBe('committed');
      expect(Number(next[0].version)).toBe(3);
    });
  });

  it('non-owner member cannot supersede a leader-owned handover chain', async () => {
    const docKey = 'ho-leader';
    await scenario(async () => {
      await act('authenticated', fx.leader);
      await rpcNamed('rev_publish_document', {
        p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'handover',
        p_doc_key: docKey, p_expected_version: 0, p_payload: goodHandoverPayload(),
      });

      await act('authenticated', fx.member);
      const err = await rpcError('rev_publish_document', {
        p_team_id: fx.teamA, p_project_key: 'a1b2c3d4e5', p_kind: 'handover',
        p_doc_key: docKey, p_expected_version: 1, p_payload: goodHandoverPayload(),
      });
      expect(err).toMatch(/rev_forbidden_not_owner/);
    });
  });

  it('cross-team protection: member of A cannot read or write team B', async () => {
    await scenario(async () => {
      await act('authenticated', fx.otherLeader);
      await rpcNamed('rev_publish_document', {
        p_team_id: fx.teamB, p_project_key: 'b12345678', p_kind: 'analysis',
        p_doc_key: 'b-doc', p_expected_version: 0, p_payload: goodAnalysisPayload('b12345678'),
      });

      await act('authenticated', fx.member);
      await expect(rpcError('rev_publish_document', {
        p_team_id: fx.teamB, p_project_key: 'b12345678', p_kind: 'analysis',
        p_doc_key: 'x', p_expected_version: 0, p_payload: goodAnalysisPayload('b12345678'),
      })).resolves.toMatch(/rev_forbidden_not_member/);
      expect(await rpcNamed('rev_list_documents', { p_team_id: fx.teamB, p_project_key: 'b12345678' })).toEqual([]);
      const rls = await selectWhere('rev_documents', 'team_id = $1', [fx.teamB]);
      expect(rls).toHaveLength(0);
    });
  });
});
