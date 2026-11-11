import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runSchema, type Run } from '@/lib/contracts';
import { teamProjectRequestSchema, teamSyncRequestSchema } from '@/lib/team-contracts';
import { database, getRun } from '@/lib/server/store';
import { ANALYZER_VERSION, digest, eligibleRuns, ensureTeamTables, pendingAnalysis, projectIdentity, type CachedAnalysis, type ShareableRun } from '@/lib/server/team-local';
import { configureTeam, currentTeam, disconnectTeam, teamRpc, teamSessionStatus } from '@/lib/server/team-remote';

const remoteRowSchema = z.object({
  document_id: z.string().uuid(), project_key: z.string(), kind: z.enum(['analysis', 'handover']),
  doc_key: z.string(), version: z.union([z.number(), z.string()]).transform(Number), created_by: z.string().uuid(),
  status: z.enum(['committed', 'conflict']), payload: z.unknown(),
});
type RemoteRow = z.infer<typeof remoteRowSchema>;
const publishResultSchema = z.object({ document_id: z.string().uuid(), version: z.union([z.number(), z.string()]).transform(Number), status: z.enum(['committed', 'conflict']) });
const symbolSchema = z.object({ name: z.string().max(1000), kind: z.string().max(100), startLine: z.number().int().nonnegative(), endLine: z.number().int().nonnegative(), signature: z.string().max(10_000).optional() }).strict();
const analysisSchema = z.object({
  version: z.literal(1), projectKey: z.string(), analyzerVersion: z.string(), commit: z.string().regex(/^[a-f0-9]{40,64}$/i),
  report: z.object({ commitSha: z.string(), authorName: z.string(), authorEmail: z.string(), message: z.string(), files: z.array(z.object({
    filePath: z.string().max(4096), language: z.string().max(100), totalSymbols: z.number().int().nonnegative(),
    changedSymbols: z.array(z.object({ symbol: symbolSchema, filePath: z.string().max(4096), changeKind: z.enum(['added', 'modified', 'deleted']) }).strict()).max(10000),
  }).strict()).max(10000) }).strict(),
}).strict();

type Preview = { id: string; teamId: string; userId: string; root: string; projectKey: string; createdAt: number; analysis: CachedAnalysis[]; runs: ShareableRun[]; remote: RemoteRow[] };
const previews = new Map<string, Preview>();

async function listRemote(projectKey: string): Promise<RemoteRow[]> {
  const session = currentTeam();
  const data = await teamRpc('rev_list_documents', { p_team_id: session.teamId, p_project_key: projectKey, p_kind: null });
  const rows = z.array(remoteRowSchema).max(10_000).parse(data);
  if (rows.some(row => row.project_key !== projectKey || !Number.isSafeInteger(row.version) || row.version < 1)) throw new Error('Team server returned inconsistent project data');
  return rows;
}
function latestRows(rows: RemoteRow[]): RemoteRow[] {
  const latest = new Map<string, RemoteRow>();
  for (const row of rows) {
    if (row.status !== 'committed') continue;
    const key = `${row.kind}:${row.doc_key}`;
    const previous = latest.get(key);
    if (!previous || previous.version < row.version) latest.set(key, row);
  }
  return [...latest.values()];
}
async function getProject(raw: unknown) {
  const args = teamProjectRequestSchema.parse(raw);
  if (!args.projectRoot) throw new Error('Choose a project workspace before syncing');
  return projectIdentity(args.projectRoot);
}

export async function teamStatus(raw: unknown) {
  const session = teamSessionStatus();
  const args = teamProjectRequestSchema.parse(raw);
  const empty = { configured: session.connected, url: session.url ?? null, teamId: session.teamId ?? null, projectKey: null, projectRoot: args.projectRoot ?? null,
    pending: { outgoingRuns: 0, incomingUpdates: 0, conflicts: 0 }, lastSync: null, conflicts: [],
    capabilities: { resolve: false, incomingFetch: true }, warnings: [] as string[] };
  if (!session.connected || !args.projectRoot) return empty;
  const { root, projectKey } = await getProject(args);
  await ensureTeamTables();
  const db = await database();
  const [runs, log, conflicts] = await Promise.all([
    eligibleRuns(root),
    db.query<{ last_sync: string | Date }>('SELECT last_sync FROM team_sync_log WHERE team_id=$1 AND project_key=$2', [session.teamId, projectKey]),
    db.query<{ id: string; created_at: string | Date }>('SELECT id,created_at FROM team_sync_conflicts WHERE team_id=$1 AND project_key=$2 AND NOT resolved ORDER BY created_at DESC', [session.teamId, projectKey]),
  ]);
  return { ...empty, projectKey, projectRoot: root, pending: { outgoingRuns: runs.length, incomingUpdates: 0, conflicts: conflicts.rows.length },
    lastSync: log.rows[0] ? { at: new Date(log.rows[0].last_sync).toISOString(), ok: true, detail: null } : null,
    conflicts: conflicts.rows.map(c => ({ conflictId: c.id, summary: 'Concurrent handover edits preserved locally', detectedAt: new Date(c.created_at).toISOString(), localLabel: 'Local version', incomingLabel: 'Team version' })),
    warnings: ['Incoming update count is determined when you preview. Conflicting versions are retained for review.'] };
}

export async function teamPreview(raw: unknown) {
  const session = currentTeam();
  const { root, projectKey } = await getProject(raw);
  await ensureTeamTables();
  const [analysis, runs, remote] = await Promise.all([pendingAnalysis(projectKey, session.teamId), eligibleRuns(root), listRemote(projectKey)]);
  const incoming = latestRows(remote);
  const id = randomUUID();
  for (const [key, value] of previews) if (Date.now() - value.createdAt > 10 * 60_000) previews.delete(key);
  previews.set(id, { id, teamId: session.teamId, userId: session.userId, root, projectKey, createdAt: Date.now(), analysis, runs, remote: incoming });
  const manifest = analysis.flatMap(a => a.report.files.flatMap(f => f.changedSymbols.map(s => ({ path: f.filePath, excerpt: `${s.symbol.name} (${s.symbol.kind}): ${s.symbol.signature ?? ''}`, sensitive: true, reason: 'Filenames and symbol signatures can reveal source code.' }))));
  return { previewId: id, projectKey, projectRoot: root, counts: { runs: runs.length, eligibleRuns: 0, items: analysis.length, artifacts: manifest.length,
    sensitivePaths: manifest.length, incomingRuns: incoming.filter(r => r.kind === 'handover').length, incomingItems: incoming.filter(r => r.kind === 'analysis').length },
    manifest, runs: runs.map(r => ({ runId: r.id, label: r.title, itemCount: r.payload.items.length, eligible: false, ineligibleReason: 'Local user authorization is incomplete; sharing is disabled.' })),
    generatedAt: new Date().toISOString(), warnings: ['Team sync is disabled until local per-user authorization is complete.'] };
}

async function publish(projectKey: string, kind: 'analysis' | 'handover', docKey: string, expectedVersion: number, payload: unknown) {
  const session = currentTeam();
  const data = await teamRpc('rev_publish_document', { p_team_id: session.teamId, p_project_key: projectKey, p_kind: kind,
    p_doc_key: docKey, p_expected_version: expectedVersion, p_payload: payload, p_operation_id: randomUUID() });
  return publishResultSchema.parse(Array.isArray(data) ? data[0] : data);
}

async function importHandover(row: RemoteRow, root: string, teamId: string): Promise<boolean> {
  const payload = runSchema.parse(row.payload);
  if (payload.id !== row.doc_key || payload.projectRoot || payload.artifacts.some(a => a.kind === 'working_change')) throw new Error('Rejected unsafe incoming handover');
  const db = await database();
  const existing = await getRun(payload.id);
  const sync = await db.query<{ remote_revision: number | string; synced_fingerprint: string | null }>(
    'SELECT remote_revision,synced_fingerprint FROM team_run_sync WHERE team_id=$1 AND project_key=$2 AND run_id=$3', [teamId, row.project_key, payload.id]);
  if (sync.rows[0] && Number(sync.rows[0].remote_revision) >= row.version) return false;
  if (existing && (!sync.rows[0]?.synced_fingerprint || digest(existing) !== sync.rows[0].synced_fingerprint)) {
    const existingConflict = await db.query('SELECT 1 FROM team_sync_conflicts WHERE team_id=$1 AND project_key=$2 AND run_id=$3 AND remote_revision=$4 AND NOT resolved', [teamId, row.project_key, payload.id, row.version]);
    if (!existingConflict.rows.length) await db.query('INSERT INTO team_sync_conflicts(id,team_id,project_key,run_id,local_payload,remote_payload,remote_revision) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)', [randomUUID(), teamId, row.project_key, payload.id, JSON.stringify(existing), JSON.stringify(payload), row.version]);
    return false;
  }
  const localRun: Run = { ...payload, projectRoot: root };
  const { graphEvents, sourceEvents, ...base } = localRun;
  await db.transaction(async tx => {
    const locked = await tx.query<{ payload: Run; version: number }>('SELECT payload,version FROM runs WHERE id=$1 FOR UPDATE', [localRun.id]);
    if (existing && (!locked.rows.length || !sync.rows[0]?.synced_fingerprint)) throw new Error('Handover changed during sync; retry');
    if (locked.rows.length) {
      const graph = await tx.query<{ event: NonNullable<Run['graphEvents']>[number] }>('SELECT event FROM graph_events WHERE run_id=$1 ORDER BY seq', [localRun.id]);
      const source = await tx.query<{ event: NonNullable<Run['sourceEvents']>[number] }>('SELECT event FROM source_events WHERE run_id=$1 ORDER BY seq', [localRun.id]);
      const current = { ...locked.rows[0].payload, graphEvents: graph.rows.map(x => x.event), sourceEvents: source.rows.map(x => x.event) };
      if (digest(current) !== sync.rows[0]?.synced_fingerprint) throw new Error('Handover changed during sync; retry');
      await tx.query('UPDATE runs SET payload=$2::jsonb,version=version+1 WHERE id=$1', [localRun.id, JSON.stringify(base)]);
    } else {
      await tx.query('INSERT INTO runs(id,created_at,payload) VALUES ($1,$2,$3::jsonb)', [localRun.id, localRun.createdAt, JSON.stringify(base)]);
    }
    for (const event of graphEvents ?? []) await tx.query('INSERT INTO graph_events(run_id,event_id,event) VALUES ($1,$2,$3::jsonb) ON CONFLICT(event_id) DO NOTHING', [localRun.id,event.id,JSON.stringify(event)]);
    for (const event of sourceEvents ?? []) await tx.query('INSERT INTO source_events(run_id,event_id,event) VALUES ($1,$2,$3::jsonb) ON CONFLICT(event_id) DO NOTHING', [localRun.id,event.id,JSON.stringify(event)]);
    await tx.query('INSERT INTO team_run_sync(team_id,project_key,run_id,remote_revision,synced_fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT(team_id,project_key,run_id) DO UPDATE SET remote_revision=EXCLUDED.remote_revision,synced_fingerprint=EXCLUDED.synced_fingerprint', [teamId,row.project_key,localRun.id,row.version,digest(localRun)]);
  });
  return true;
}

export async function teamSync(raw: unknown) {
  const args = teamSyncRequestSchema.parse(raw);
  const session = currentTeam();
  const preview = previews.get(args.previewId);
  if (!preview || preview.teamId !== session.teamId || preview.userId !== session.userId || Date.now() - preview.createdAt > 10 * 60_000) throw new Error('Preview expired; preview the sync again');
  if (!args.projectRoot) throw new Error('Choose a project workspace before syncing');
  const project = await getProject({ projectRoot: args.projectRoot ?? preview.root });
  if (project.root !== preview.root || project.projectKey !== preview.projectKey) throw new Error('Project changed; preview again');
  const uniqueRuns = new Set(args.sharedRunIds);
  if (args.sharedRunIds.length > 0) throw new Error('Handover team sharing is not enabled until per-user local access controls are verified. Nothing was uploaded.');
  if (uniqueRuns.size !== args.sharedRunIds.length || args.sharedRunIds.some(id => !preview.runs.some(run => run.id === id))) throw new Error('Only handovers shown in this preview may be shared');
  // Re-read all data before any write to bind consent to exactly the previewed payload.
  const [currentRuns, currentAnalysis] = await Promise.all([eligibleRuns(project.root), pendingAnalysis(project.projectKey, session.teamId)]);
  for (const id of args.sharedRunIds) {
    const before = preview.runs.find(run => run.id === id)!;
    if (currentRuns.find(run => run.id === id)?.fingerprint !== before.fingerprint) throw new Error('Handover changed since preview; preview again');
  }
  if (args.shareAnalysis && digest(currentAnalysis) !== digest(preview.analysis)) throw new Error('Analysis changed since preview; preview again');
  previews.delete(args.previewId);
  let incomingApplied = 0;
  const db = await database();
  const warnings: string[] = [];
  for (const row of preview.remote) {
    if (row.kind === 'analysis') {
      const safe = analysisSchema.parse(row.payload);
      if (safe.projectKey !== project.projectKey || safe.analyzerVersion !== ANALYZER_VERSION || safe.commit !== safe.report.commitSha || row.doc_key !== `${safe.analyzerVersion}:${safe.commit}`) continue;
      const exists = await db.query('SELECT 1 FROM team_analysis_cache WHERE project_key=$1 AND analyzer_version=$2 AND commit_id=$3', [project.projectKey, safe.analyzerVersion, safe.commit]);
      if (!exists.rows.length) {
        await db.query('INSERT INTO team_analysis_cache(project_key,analyzer_version,commit_id,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING', [project.projectKey,safe.analyzerVersion,safe.commit,JSON.stringify(safe)]);
        incomingApplied++;
      }
      await db.query('INSERT INTO team_analysis_sync(team_id,project_key,doc_key,remote_revision,synced_fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT(team_id,project_key,doc_key) DO UPDATE SET remote_revision=EXCLUDED.remote_revision,synced_fingerprint=EXCLUDED.synced_fingerprint', [session.teamId,project.projectKey,row.doc_key,row.version,digest(safe)]);
    } else {
      warnings.push('A team handover is available but was not imported: per-user local access controls are not yet enabled.');
    }
  }
  let runsShared = 0;
  const actuallySharedRunIds: string[] = [];
  let itemsShared = 0;
  if (args.shareAnalysis) for (const analysis of preview.analysis) {
    analysisSchema.parse(analysis);
    const key = `${analysis.analyzerVersion}:${analysis.commit}`;
    const known = preview.remote.find(r => r.kind === 'analysis' && r.doc_key === key);
    if (known) {
      if (digest(known.payload) !== digest(analysis)) warnings.push(`Analysis ${analysis.commit.slice(0, 8)} differs from the shared cache; neither version was overwritten.`);
      continue;
    }
    const result = await publish(project.projectKey, 'analysis', key, 0, analysis);
    if (result.status !== 'committed') { warnings.push(`Analysis ${analysis.commit.slice(0, 8)} conflicted; neither version was overwritten.`); continue; }
    await db.query('INSERT INTO team_analysis_sync(team_id,project_key,doc_key,remote_revision,synced_fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT(team_id,project_key,doc_key) DO UPDATE SET remote_revision=EXCLUDED.remote_revision,synced_fingerprint=EXCLUDED.synced_fingerprint', [session.teamId,project.projectKey,key,result.version,digest(analysis)]);
    itemsShared++;
  }
  for (const id of args.sharedRunIds) {
    const run = preview.runs.find(r => r.id === id)!;
    const localNow = await getRun(id);
    if (!localNow || digest(localNow) !== run.localFingerprint) {
      warnings.push(`Handover ${run.title} changed while syncing; it was not uploaded.`);
      continue;
    }
    const knownLocal = await db.query<{ remote_revision: number | string }>('SELECT remote_revision FROM team_run_sync WHERE team_id=$1 AND project_key=$2 AND run_id=$3', [session.teamId, project.projectKey, id]);
    const remoteAtPreview = preview.remote.find(r => r.kind === 'handover' && r.doc_key === id);
    if (remoteAtPreview && Number(knownLocal.rows[0]?.remote_revision ?? 0) !== remoteAtPreview.version) {
      warnings.push(`Handover ${run.title} has a team update; review the preserved conflict before uploading.`);
      continue;
    }
    const known = preview.remote.find(r => r.kind === 'handover' && r.doc_key === id);
    const result = await publish(project.projectKey, 'handover', id, known?.version ?? 0, run.payload);
    if (result.status !== 'committed') {
      const latest = latestRows(await listRemote(project.projectKey)).find(row => row.kind === 'handover' && row.doc_key === id);
      if (latest) await importHandover(latest, project.root, session.teamId);
      warnings.push(`Handover ${run.title} conflicted; both versions remain available.`);
      continue;
    }
    await db.query('INSERT INTO team_run_sync(team_id,project_key,run_id,remote_revision,synced_fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT(team_id,project_key,run_id) DO UPDATE SET remote_revision=EXCLUDED.remote_revision,synced_fingerprint=EXCLUDED.synced_fingerprint', [session.teamId,project.projectKey,id,result.version,run.localFingerprint]);
    runsShared++;
    actuallySharedRunIds.push(id);
  }
  await db.query('INSERT INTO team_sync_log(team_id,project_key,last_sync) VALUES($1,$2,NOW()) ON CONFLICT(team_id,project_key) DO UPDATE SET last_sync=NOW()', [session.teamId,project.projectKey]);
  return { synced: true, previewId: preview.id, projectKey: project.projectKey, counts: { runsShared, itemsShared, incomingApplied, analysisShared: args.shareAnalysis && itemsShared > 0 }, sharedRunIds: actuallySharedRunIds, syncedAt: new Date().toISOString(), warnings };
}

export async function teamAction(action: string, payload: unknown): Promise<unknown> {
  switch (action) {
    case 'configure': { const result = await configureTeam(payload); return { configured: true, url: result.url, teamId: result.teamId, warnings: [] }; }
    case 'status': return teamStatus(payload);
    case 'preview': return teamPreview(payload);
    case 'sync': return teamSync(payload);
    case 'disconnect': disconnectTeam(); previews.clear(); return { connected: false };
    default: throw new Error('Unsupported team operation');
  }
}
