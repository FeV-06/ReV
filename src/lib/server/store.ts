import { PGlite } from '@electric-sql/pglite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Run } from '@/lib/contracts';

const globalDb = globalThis as typeof globalThis & { revDb?: Promise<PGlite> };
export function database(): Promise<PGlite> {
  if (!globalDb.revDb) globalDb.revDb = open();
  return globalDb.revDb;
}
async function open(): Promise<PGlite> {
  const dir = path.resolve(/*turbopackIgnore: true*/ process.env.REV_DATA_DIR || '.rev-data');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const db = await PGlite.create(path.join(dir, 'pglite'));
  await db.exec(`CREATE TABLE IF NOT EXISTS runs (
    id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL, version BIGINT NOT NULL DEFAULT 0
  );
  ALTER TABLE runs ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
  CREATE TABLE IF NOT EXISTS approved_revisions (
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL, approved_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL, PRIMARY KEY (run_id, revision)
  );`);
  return db;
}
export async function createRun(run: Run): Promise<void> {
  const db = await database();
  await db.query('INSERT INTO runs (id, created_at, payload) VALUES ($1, $2, $3::jsonb)', [run.id, run.createdAt, JSON.stringify(run)]);
}
export async function getVersionedRun(id: string): Promise<{run: Run; version: number} | null> {
  const db = await database();
  const result = await db.query<{payload: Run; version: string|number}>('SELECT payload, version FROM runs WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? {run: row.payload, version: Number(row.version)} : null;
}
export async function getRun(id: string): Promise<Run | null> { return (await getVersionedRun(id))?.run ?? null; }
export async function listRuns(): Promise<Pick<Run, 'id'|'createdAt'|'recipient'|'state'>[]> {
  const db = await database();
  const result = await db.query<{payload: Run}>('SELECT payload FROM runs ORDER BY created_at DESC LIMIT 50');
  return result.rows.map(({payload}) => ({ id: payload.id, createdAt: payload.createdAt, recipient: payload.recipient, state: payload.state }));
}
export async function updateRun(run: Run): Promise<void> {
  const db = await database();
  await db.query('UPDATE runs SET payload = $2::jsonb, version = version + 1 WHERE id = $1', [run.id, JSON.stringify(run)]);
}
export async function compareAndUpdate(run: Run, expectedVersion: number): Promise<number> {
  const db = await database();
  const result = await db.query<{version: string|number}>('UPDATE runs SET payload = $2::jsonb, version = version + 1 WHERE id = $1 AND version = $3 RETURNING version', [run.id, JSON.stringify(run), expectedVersion]);
  if (!result.rows[0]) throw new Error('Run changed in another request. Reload before continuing.');
  return Number(result.rows[0].version);
}
export async function approveRun(run: Run, expectedVersion: number): Promise<void> {
  const db = await database();
  await db.transaction(async tx => {
    const result = await tx.query('UPDATE runs SET payload = $2::jsonb, version = version + 1 WHERE id = $1 AND version = $3 RETURNING version', [run.id, JSON.stringify(run), expectedVersion]);
    if (!result.rows.length) throw new Error('Run changed in another request. Reload before continuing.');
    await tx.query('INSERT INTO approved_revisions (run_id, revision, approved_at, payload) VALUES ($1, $2, $3, $4::jsonb)', [run.id, run.revision, new Date().toISOString(), JSON.stringify(run)]);
  });
}
export async function deleteRun(id: string): Promise<void> {
  const db = await database();
  await db.query('DELETE FROM runs WHERE id = $1', [id]);
}
