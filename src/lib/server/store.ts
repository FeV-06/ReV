import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Run } from '@/lib/contracts';
import type { RunArchive } from '@/lib/server/archive';

const schemaVersion = 1;
export type RunAuthority = { userId: string; teamId: string; role: 'leader' | 'member' };
const globalDb = globalThis as typeof globalThis & {
  revDb?: Promise<PGlite>;
  revDbSchema?: { version: number; ready: Promise<PGlite> };
};

export function database(): Promise<PGlite> {
  // Next dev can reload this module while retaining the previous connection.
  if (globalDb.revDbSchema?.version === schemaVersion) return globalDb.revDbSchema.ready;
  const existing = globalDb.revDbSchema?.ready ?? globalDb.revDb;
  const ready = (existing ?? open()).then(async db => {
    await migrate(db);
    if (!existing) await recoverInterruptedRuns(db);
    return db;
  });
  globalDb.revDbSchema = { version: schemaVersion, ready };
  return ready;
}
export async function closeDatabase(): Promise<void> {
  const pending = globalDb.revDbSchema?.ready ?? globalDb.revDb;
  if (!pending) return;
  try {
    const db = await pending;
    await db.close();
  } finally {
    delete globalDb.revDb;
    delete globalDb.revDbSchema;
  }
}
async function open(): Promise<PGlite> {
  const dir = path.resolve(/*turbopackIgnore: true*/ process.env.REV_DATA_DIR || '.rev-data');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return PGlite.create(path.join(dir, 'pglite'));
}

async function migrate(db: PGlite): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS runs (
    id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL, version BIGINT NOT NULL DEFAULT 0
  );
  ALTER TABLE runs ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
  CREATE TABLE IF NOT EXISTS approved_revisions (
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL, approved_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL, PRIMARY KEY (run_id, revision)
  );
  CREATE TABLE IF NOT EXISTS graph_events (
    seq BIGSERIAL PRIMARY KEY, run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    event_id UUID NOT NULL UNIQUE, event JSONB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS source_events (
    seq BIGSERIAL PRIMARY KEY, run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    event_id UUID NOT NULL UNIQUE, event JSONB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY, root TEXT NOT NULL, root_key TEXT NOT NULL UNIQUE,
    github_username TEXT NOT NULL, git_common_dir TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL, paused BOOLEAN NOT NULL DEFAULT FALSE
  );
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS git_dir TEXT;
  CREATE TABLE IF NOT EXISTS project_snapshots (
    id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    observed_at TIMESTAMPTZ NOT NULL, fingerprint TEXT NOT NULL,
    payload JSONB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS project_snapshots_latest ON project_snapshots(project_id, observed_at DESC);
  INSERT INTO graph_events (run_id,event_id,event)
    SELECT r.id,(e.value->>'id')::uuid,e.value
    FROM runs r CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.payload->'graphEvents','[]'::jsonb)) e(value)
    ON CONFLICT (event_id) DO NOTHING;
  UPDATE runs SET payload = payload - 'graphEvents' WHERE payload ? 'graphEvents';
  CREATE TABLE IF NOT EXISTS run_permissions (
    run_id UUID PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    team_id UUID NOT NULL, owner_id UUID NOT NULL,
    visibility TEXT NOT NULL CHECK (visibility IN ('private', 'lead')),
    revision BIGINT NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS run_permission_events (
    id UUID PRIMARY KEY, run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    team_id UUID NOT NULL, actor_id UUID NOT NULL, old_visibility TEXT,
    new_visibility TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);
}

async function recoverInterruptedRuns(db: PGlite): Promise<void> {
  await db.exec(`UPDATE runs SET payload = jsonb_set(jsonb_set(payload, '{state}', '"failed"'::jsonb), '{warnings}', COALESCE(payload->'warnings','[]'::jsonb) || '["Run was interrupted by a server restart; retry generation or import."]'::jsonb), version = version + 1
  WHERE payload->>'state' IN ('importing','reconstructing');`);
}
export async function createRun(run: Run, authority?: RunAuthority): Promise<void> {
  const db = await database();
  await db.transaction(async tx => {
    await tx.query('INSERT INTO runs (id, created_at, payload) VALUES ($1, $2, $3::jsonb)', [run.id, run.createdAt, JSON.stringify(run)]);
    if (authority) {
      await tx.query("INSERT INTO run_permissions(run_id,team_id,owner_id,visibility) VALUES($1,$2,$3,'private')", [run.id, authority.teamId, authority.userId]);
      await tx.query("INSERT INTO run_permission_events(id,run_id,team_id,actor_id,old_visibility,new_visibility) VALUES($1,$2,$3,$4,NULL,'private')", [randomUUID(), run.id, authority.teamId, authority.userId]);
    }
  });
}
/** Refresh inherits the source run's owner and visibility, never the editor's identity. */
export async function createRefreshedRun(run: Run, sourceId: string, expectedRevision: number, authority: RunAuthority): Promise<void> {
  const db = await database();
  await db.transaction(async tx => {
    const source = await tx.query<{owner_id: string; team_id: string; visibility: string}>(`SELECT p.owner_id,p.team_id,p.visibility FROM run_permissions p JOIN runs r ON r.id=p.run_id
      WHERE p.run_id=$1 AND p.team_id=$2 AND (p.owner_id=$3 OR ($4='leader' AND p.visibility='lead'))
      AND (r.payload->>'revision')::bigint=$5 FOR UPDATE OF r,p`,
      [sourceId,authority.teamId,authority.userId,authority.role,expectedRevision]);
    if (!source.rows[0]) throw new Error('Handover changed or access was revoked');
    const prior = source.rows[0];
    await tx.query('INSERT INTO runs (id, created_at, payload) VALUES ($1, $2, $3::jsonb)', [run.id, run.createdAt, JSON.stringify(run)]);
    await tx.query('INSERT INTO run_permissions(run_id,team_id,owner_id,visibility) VALUES($1,$2,$3,$4)', [run.id, prior.team_id, prior.owner_id, prior.visibility]);
    await tx.query('INSERT INTO run_permission_events(id,run_id,team_id,actor_id,old_visibility,new_visibility) VALUES($1,$2,$3,$4,NULL,$5)', [randomUUID(),run.id,prior.team_id,authority.userId,prior.visibility]);
  });
}

export async function getVersionedRun(id: string): Promise<{run: Run; version: number} | null> {
  const db = await database();
  const result = await db.query<{payload: Run; version: string|number}>(`SELECT r.payload || jsonb_build_object('graphEvents', COALESCE((SELECT jsonb_agg(g.event ORDER BY g.seq) FROM graph_events g WHERE g.run_id=r.id),'[]'::jsonb), 'sourceEvents', COALESCE((SELECT jsonb_agg(s.event ORDER BY s.seq) FROM source_events s WHERE s.run_id=r.id),'[]'::jsonb)) AS payload, r.version FROM runs r WHERE r.id = $1`, [id]);
  const row = result.rows[0];
  return row ? {run: row.payload, version: Number(row.version)} : null;
}
export async function getRun(id: string): Promise<Run | null> { return (await getVersionedRun(id))?.run ?? null; }
export async function listRuns(): Promise<Pick<Run, 'id'|'createdAt'|'recipient'|'state'|'successorEmail'|'projectRoot'>[]> {
  const db = await database();
  const result = await db.query<{payload: Run}>('SELECT payload FROM runs ORDER BY created_at DESC LIMIT 50');
  return result.rows.map(({payload}) => ({ id: payload.id, createdAt: payload.createdAt, recipient: payload.recipient, state: payload.state, successorEmail: payload.successorEmail, projectRoot: payload.projectRoot }));
}

export async function listRunsForAuthority(authority: RunAuthority): Promise<Pick<Run, 'id'|'createdAt'|'recipient'|'state'|'successorEmail'|'projectRoot'>[]> {
  const db = await database();
  const result = await db.query<{payload: Run}>(`SELECT r.payload FROM runs r JOIN run_permissions p ON p.run_id=r.id
    WHERE p.team_id=$1 AND (p.owner_id=$2 OR ($3='leader' AND p.visibility='lead')) ORDER BY r.created_at DESC LIMIT 50`,
    [authority.teamId, authority.userId, authority.role]);
  return result.rows.map(({payload}) => ({ id: payload.id, createdAt: payload.createdAt, recipient: payload.recipient, state: payload.state, successorEmail: payload.successorEmail, projectRoot: payload.projectRoot }));
}

export async function assertRunAuthority(id: string, authority: RunAuthority, action: 'read' | 'edit' | 'delete' = 'read'): Promise<void> {
  const db = await database();
  const result = await db.query(`SELECT 1 FROM run_permissions p WHERE p.run_id=$1 AND p.team_id=$2
    AND (p.owner_id=$3 OR ($4='leader' AND p.visibility='lead' AND $5 <> 'delete'))`,
    [id, authority.teamId, authority.userId, authority.role, action]);
  if (!result.rows.length) throw new Error('Handover not found or access denied');
}

export async function compareAndUpdate(run: Run, expectedVersion: number, authority?: RunAuthority): Promise<number> {
  const db = await database();
  return db.transaction(async tx=>{
    const {graphEvents,sourceEvents,...payload}=run;
    const result = await tx.query<{version: string|number}>(`UPDATE runs SET payload = $2::jsonb, version = version + 1 WHERE id = $1 AND version = $3
      AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM run_permissions p WHERE p.run_id=runs.id AND p.team_id=$4 AND (p.owner_id=$5 OR ($6='leader' AND p.visibility='lead')))) RETURNING version`,
      [run.id, JSON.stringify(payload), expectedVersion, authority?.teamId ?? null, authority?.userId ?? null, authority?.role ?? null]);
    if (!result.rows[0]) throw new Error('Run changed in another request. Reload before continuing.');
    for(const event of graphEvents||[]) await tx.query('INSERT INTO graph_events (run_id,event_id,event) VALUES ($1,$2,$3::jsonb) ON CONFLICT (event_id) DO NOTHING',[run.id,event.id,JSON.stringify(event)]);
    for(const event of sourceEvents||[]) await tx.query('INSERT INTO source_events (run_id,event_id,event) VALUES ($1,$2,$3::jsonb) ON CONFLICT (event_id) DO NOTHING',[run.id,event.id,JSON.stringify(event)]);
    return Number(result.rows[0].version);
  });
}
export async function approveRun(run: Run, expectedVersion: number, authority?: RunAuthority): Promise<void> {
  const db = await database();
  await db.transaction(async tx => {
    const {graphEvents,sourceEvents,...payload}=run;
    const result = await tx.query(`UPDATE runs SET payload = $2::jsonb, version = version + 1 WHERE id = $1 AND version = $3
      AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM run_permissions p WHERE p.run_id=runs.id AND p.team_id=$4 AND (p.owner_id=$5 OR ($6='leader' AND p.visibility='lead')))) RETURNING version`,
      [run.id, JSON.stringify(payload), expectedVersion, authority?.teamId ?? null, authority?.userId ?? null, authority?.role ?? null]);
    if (!result.rows.length) throw new Error('Run changed in another request. Reload before continuing.');
    await tx.query('INSERT INTO approved_revisions (run_id, revision, approved_at, payload) VALUES ($1, $2, $3, $4::jsonb)', [run.id, run.revision, new Date().toISOString(), JSON.stringify(run)]);
  });
}
export async function deleteRun(id: string, authority?: RunAuthority): Promise<void> {
  const db = await database();
  const result = await db.query(`DELETE FROM runs WHERE id = $1 AND ($2::uuid IS NULL OR EXISTS
    (SELECT 1 FROM run_permissions p WHERE p.run_id=runs.id AND p.team_id=$2 AND p.owner_id=$3)) RETURNING id`,
    [id, authority?.teamId ?? null, authority?.userId ?? null]);
  if (authority && !result.rows.length) throw new Error('Handover not found or access denied');
}

export async function exportArchive():Promise<RunArchive>{
  const db=await database();
  return db.transaction(async tx=>{
    const runs=await tx.query<{payload:Run}>('SELECT payload FROM runs ORDER BY created_at,id');
    const approved=await tx.query<{run_id:string;revision:number;approved_at:Date|string;payload:Run}>('SELECT run_id,revision,approved_at,payload FROM approved_revisions ORDER BY run_id,revision');
    const events=await tx.query<{run_id:string;event:RunArchive["events"][number]["event"]}>('SELECT run_id,event FROM graph_events ORDER BY seq');
    const sourceEvents=await tx.query<{run_id:string;event:NonNullable<Run['sourceEvents']>[number]}>('SELECT run_id,event FROM source_events ORDER BY seq');
    return {version:1,runs:runs.rows.map(r=>r.payload),approved:approved.rows.map(r=>({runId:r.run_id,revision:r.revision,approvedAt:new Date(r.approved_at).toISOString(),payload:r.payload})),events:events.rows.map(r=>({runId:r.run_id,event:r.event})),sourceEvents:sourceEvents.rows.map(r=>({runId:r.run_id,event:r.event}))};
  });
}
