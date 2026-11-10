import { Client } from 'pg';
import { database, exportArchive } from '@/lib/server/store';
import type { Run } from '@/lib/contracts';
import type { RunArchive } from '@/lib/server/archive';

export interface SyncResult {
  success: boolean;
  syncedRuns: number;
  syncedRevisions: number;
  syncedEvents: number;
  error?: string;
  timestamp: string;
}

export function validatePostgresUrl(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    return ['postgres:', 'postgresql:'].includes(url.protocol);
  } catch {
    return false;
  }
}

/**
 * Ping test for a Postgres / Supabase connection string.
 */
export async function testPostgresConnection(connectionString: string): Promise<{ success: boolean; error?: string }> {
  if (!connectionString.trim()) {
    return { success: false, error: 'Connection string is empty' };
  }
  if (!validatePostgresUrl(connectionString)) {
    return { success: false, error: 'Invalid URL. Expected postgresql:// or postgres://' };
  }

  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('SELECT 1 AS ok');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
  } finally {
    try {
      await client.end();
    } catch {}
  }
}

/**
 * Ensures required ReV tables exist on target Supabase / Postgres instance.
 */
async function ensureRemoteSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS runs (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL,
      version BIGINT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS approved_revisions (
      run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      approved_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY (run_id, revision)
    );

    CREATE TABLE IF NOT EXISTS graph_events (
      seq BIGSERIAL PRIMARY KEY,
      run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      event_id UUID NOT NULL UNIQUE,
      event JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_events (
      seq BIGSERIAL PRIMARY KEY,
      run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      event_id UUID NOT NULL UNIQUE,
      event JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY,
      root TEXT NOT NULL,
      root_key TEXT NOT NULL UNIQUE,
      github_username TEXT NOT NULL,
      git_common_dir TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      paused BOOLEAN NOT NULL DEFAULT FALSE,
      git_dir TEXT
    );

    CREATE TABLE IF NOT EXISTS project_snapshots (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      observed_at TIMESTAMPTZ NOT NULL,
      fingerprint TEXT NOT NULL,
      payload JSONB NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_remote_snapshots_latest ON project_snapshots(project_id, observed_at DESC);
  `);
}

/**
 * Idempotently syncs local PGlite data to remote Supabase Postgres.
 * If runId is provided, syncs that run and its related events;
 * otherwise syncs all local runs.
 */
export async function syncToSupabase(connectionString: string, runId?: string): Promise<SyncResult> {
  const timestamp = new Date().toISOString();

  if (!connectionString.trim()) {
    return {
      success: false,
      syncedRuns: 0,
      syncedRevisions: 0,
      syncedEvents: 0,
      error: 'Supabase connection string is not configured',
      timestamp,
    };
  }

  if (!validatePostgresUrl(connectionString)) {
    return {
      success: false,
      syncedRuns: 0,
      syncedRevisions: 0,
      syncedEvents: 0,
      error: 'Invalid connection URL. Expected postgresql:// format',
      timestamp,
    };
  }

  // 1. Gather local data
  let runsToSync: Run[] = [];
  let revisionsToSync: RunArchive['approved'] = [];
  let graphEventsToSync: RunArchive['events'] = [];
  let sourceEventsToSync: NonNullable<RunArchive['sourceEvents']> = [];

  try {
    const archive = await exportArchive();
    if (runId) {
      runsToSync = archive.runs.filter(r => r.id === runId);
      revisionsToSync = archive.approved.filter(r => r.runId === runId);
      graphEventsToSync = archive.events.filter(e => e.runId === runId);
      sourceEventsToSync = (archive.sourceEvents || []).filter(e => e.runId === runId);
    } else {
      runsToSync = archive.runs;
      revisionsToSync = archive.approved;
      graphEventsToSync = archive.events;
      sourceEventsToSync = archive.sourceEvents || [];
    }
  } catch (err) {
    return {
      success: false,
      syncedRuns: 0,
      syncedRevisions: 0,
      syncedEvents: 0,
      error: `Could not export local PGlite data: ${err instanceof Error ? err.message : String(err)}`,
      timestamp,
    };
  }

  if (runsToSync.length === 0) {
    return {
      success: true,
      syncedRuns: 0,
      syncedRevisions: 0,
      syncedEvents: 0,
      timestamp,
    };
  }

  // 2. Connect to remote Supabase and execute idempotent UPSERTs
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN');

    await ensureRemoteSchema(client);

    // Upsert runs
    for (const run of runsToSync) {
      const { graphEvents, sourceEvents, ...payload } = run;
      await client.query(
        `INSERT INTO runs (id, created_at, payload, version)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (id) DO UPDATE SET
           payload = EXCLUDED.payload,
           version = EXCLUDED.version;`,
        [run.id, run.createdAt, JSON.stringify(payload), (run as { version?: number }).version || 0]
      );
    }

    // Upsert approved revisions
    for (const row of revisionsToSync) {
      await client.query(
        `INSERT INTO approved_revisions (run_id, revision, approved_at, payload)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (run_id, revision) DO UPDATE SET
           approved_at = EXCLUDED.approved_at,
           payload = EXCLUDED.payload;`,
        [row.runId, row.revision, row.approvedAt, JSON.stringify(row.payload)]
      );
    }

    // Insert graph events (idempotent, skip conflicts)
    for (const row of graphEventsToSync) {
      await client.query(
        `INSERT INTO graph_events (run_id, event_id, event)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (event_id) DO NOTHING;`,
        [row.runId, row.event.id, JSON.stringify(row.event)]
      );
    }

    // Insert source events (idempotent, skip conflicts)
    for (const row of sourceEventsToSync) {
      await client.query(
        `INSERT INTO source_events (run_id, event_id, event)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (event_id) DO NOTHING;`,
        [row.runId, row.event.id, JSON.stringify(row.event)]
      );
    }

    await client.query('COMMIT');

    return {
      success: true,
      syncedRuns: runsToSync.length,
      syncedRevisions: revisionsToSync.length,
      syncedEvents: graphEventsToSync.length + sourceEventsToSync.length,
      timestamp,
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    return {
      success: false,
      syncedRuns: 0,
      syncedRevisions: 0,
      syncedEvents: 0,
      error: err instanceof Error ? err.message : 'Supabase sync failed',
      timestamp,
    };
  } finally {
    try {
      await client.end();
    } catch {}
  }
}
