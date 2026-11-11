import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { database, getRun } from '@/lib/server/store';
import { inspectRoot } from '@/lib/server/projects';
import { analyzeGitSymbols } from '@/lib/server/symbols';
import { runSchema, type Run } from '@/lib/contracts';

const exec = promisify(execFile);
export const ANALYZER_VERSION = 'rev-symbols-v1';
export type CachedAnalysis = {
  version: 1;
  projectKey: string;
  analyzerVersion: string;
  commit: string;
  report: Awaited<ReturnType<typeof analyzeGitSymbols>>;
};
export type ShareableRun = { id: string; title: string; state: string; fingerprint: string; payload: Run; localFingerprint: string };

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedRepository(value: string): string {
  const raw = value.trim();
  let host = '';
  let repo = '';
  const ssh = /^(?:[^@]+@)?([^:]+):([^?#]+)$/.exec(raw);
  if (ssh && !raw.includes('://')) {
    host = ssh[1]; repo = ssh[2];
  } else {
    const url = new URL(raw);
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) throw new Error('Unsupported Git remote');
    host = url.hostname; repo = url.pathname;
  }
  repo = repo.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  if (!host || !repo || repo.includes('..')) throw new Error('Invalid Git remote');
  return `${host.toLowerCase()}/${repo.toLowerCase()}`;
}

export async function projectIdentity(projectRoot: string): Promise<{ root: string; projectKey: string }> {
  if (!path.isAbsolute(projectRoot)) throw new Error('Choose an absolute Git workspace path');
  const inspected = await inspectRoot(projectRoot);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  let remote: string;
  try {
    remote = (await exec('git', ['-C', inspected.root, 'config', '--get', 'remote.origin.url'], { env, timeout: 10_000, maxBuffer: 16_384 })).stdout.trim();
  } catch {
    throw new Error('Set a Git origin URL so teammates can identify the same project without sharing local paths.');
  }
  let identity: string;
  try { identity = normalizedRepository(remote); } catch { throw new Error('The Git origin URL cannot be used as a shared project identity.'); }
  return { root: inspected.root, projectKey: createHash('sha256').update(identity).digest('hex') };
}

export async function ensureTeamTables(): Promise<void> {
  const db = await database();
  await db.exec(`CREATE TABLE IF NOT EXISTS team_analysis_cache (
      project_key TEXT NOT NULL, analyzer_version TEXT NOT NULL, commit_id TEXT NOT NULL,
      payload JSONB NOT NULL, synced_fingerprint TEXT, PRIMARY KEY(project_key,analyzer_version,commit_id));
      CREATE TABLE IF NOT EXISTS team_run_sync (
        team_id UUID NOT NULL, project_key TEXT NOT NULL, run_id UUID NOT NULL,
        remote_revision BIGINT NOT NULL DEFAULT 0, synced_fingerprint TEXT,
        PRIMARY KEY(team_id, project_key, run_id));
      CREATE TABLE IF NOT EXISTS team_analysis_sync (
        team_id UUID NOT NULL, project_key TEXT NOT NULL, doc_key TEXT NOT NULL,
        remote_revision BIGINT NOT NULL DEFAULT 0, synced_fingerprint TEXT,
        PRIMARY KEY(team_id, project_key, doc_key));
      CREATE TABLE IF NOT EXISTS team_sync_conflicts (
        id UUID PRIMARY KEY, team_id UUID NOT NULL, project_key TEXT NOT NULL, run_id UUID NOT NULL,
        local_payload JSONB NOT NULL, remote_payload JSONB NOT NULL, remote_revision BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved BOOLEAN NOT NULL DEFAULT FALSE);
      CREATE TABLE IF NOT EXISTS team_sync_log (
        team_id UUID NOT NULL, project_key TEXT NOT NULL, last_sync TIMESTAMPTZ NOT NULL,
        PRIMARY KEY(team_id, project_key));`);
}

export async function analysisFromCache(projectKey: string, commit: string): Promise<CachedAnalysis['report'] | null> {
  await ensureTeamTables();
  const result = await (await database()).query<{ payload: CachedAnalysis }>(
    'SELECT payload FROM team_analysis_cache WHERE project_key=$1 AND analyzer_version=$2 AND commit_id=$3',
    [projectKey, ANALYZER_VERSION, commit],
  );
  return result.rows[0]?.payload?.report ?? null;
}

export async function getOrAnalyzeCommit(root: string, commit: string): Promise<CachedAnalysis['report']> {
  return analyzeGitSymbols(root, commit);
}

export async function pendingAnalysis(projectKey: string, teamId: string): Promise<CachedAnalysis[]> {
  await ensureTeamTables();
  const result = await (await database()).query<{ payload: CachedAnalysis; synced_fingerprint: string | null }>(
    `SELECT c.payload, s.synced_fingerprint FROM team_analysis_cache c
     LEFT JOIN team_analysis_sync s ON s.team_id=$2 AND s.project_key=c.project_key
       AND s.doc_key=(c.analyzer_version || ':' || c.commit_id)
     WHERE c.project_key=$1 ORDER BY c.commit_id`, [projectKey, teamId],
  );
  return result.rows.filter(row => row.synced_fingerprint !== digest(row.payload)).map(row => row.payload);
}

export async function eligibleRuns(root: string): Promise<ShareableRun[]> {
  const canonicalRoot = await realpath(root);
  const rows = await (await database()).query<{ id: string }>('SELECT id FROM runs ORDER BY created_at DESC LIMIT 500');
  const result: ShareableRun[] = [];
  for (const row of rows.rows) {
    const run = await getRun(row.id);
    if (!run?.projectRoot) continue;
    if (!['needs_review', 'approved'].includes(run.state)) continue;
    let runRoot: string;
    try { runRoot = await realpath(run.projectRoot); } catch { continue; }
    if (runRoot !== canonicalRoot) continue;
    const selected = new Set(run.selectedIds);
    // A shared handover is an authorized projection, never the complete local run.
    const allowed = run.artifacts.filter(a => selected.has(a.id) && a.kind !== 'working_change');
    if (allowed.length !== run.selectedIds.length) continue;
    if (run.items.some(item => item.derivationSourceIds?.some(id => !selected.has(id)) || item.citations.some(cite => !selected.has(cite.sourceId)))) continue;
    const sharedSources = new Set(allowed.map(item => item.id));
    const payload = runSchema.parse({ ...run, projectRoot: undefined, artifacts: allowed,
      graphEvents: (run.graphEvents ?? []).filter(e => e.edge.evidenceSourceIds.every(id => sharedSources.has(id))),
      sourceEvents: (run.sourceEvents ?? []).filter(e => sharedSources.has(e.parentSourceId) && sharedSources.has(e.redactedSourceId)),
      gaps: (run.gaps ?? []).filter(g => g.sourceIds.every(id => sharedSources.has(id)) && (!g.answerSourceId || sharedSources.has(g.answerSourceId))),
    });
    result.push({ id: run.id, title: run.recipient, state: run.state, fingerprint: digest(payload), payload, localFingerprint: digest(run) });
  }
  return result;
}

export function newConflictId(): string { return randomUUID(); }
