import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { database, createRun, getRun, closeDatabase } from '@/lib/server/store';
import { ANALYZER_VERSION, digest, ensureTeamTables, projectIdentity, getOrAnalyzeCommit } from '@/lib/server/team-local';
import { configureTeam, disconnectTeam, validateSupabaseProjectUrl } from '@/lib/server/team-remote';
import { teamPreview, teamSync } from '@/lib/server/team-sync';
import type { Run } from '@/lib/contracts';

const dbDir = path.join(tmpdir(), `rev-team-sync-test-${process.pid}`);
process.env.REV_DATA_DIR = dbDir;
const user = randomUUID();
const team = randomUUID();
let remoteRows: any[] = [];
let calls: any[] = [];
let root = '';

async function setupFixture() {
  root = await mkdtemp(path.join(tmpdir(), 'rev-team-project-'));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://github.com/example/same-project.git']);
  remoteRows = []; calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: user });
    if (url.includes('/rest/v1/rev_team_members?')) return Response.json([{ team_id: team }]);
    if (url.endsWith('/rpc/rev_list_documents')) return Response.json(remoteRows);
    if (url.endsWith('/rpc/rev_publish_document')) {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      return Response.json([{ document_id: randomUUID(), version: 1, status: 'committed' }]);
    }
    return new Response('unknown', { status: 404 });
  }));
  await configureTeam({ url:'https://example.supabase.co', publishableKey:'sb_publishable_test', accessToken:'example-user-token', teamId:team });
}

afterAll(async () => { disconnectTeam(); vi.unstubAllGlobals(); await closeDatabase(); await rm(dbDir, { recursive:true, force:true }); });

describe.skip('team sync boundaries — pending authenticated local access control', () => {
  beforeEach(setupFixture);
  it('refuses an authenticated user who is not a member of the requested team', async () => {
    const previousFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/rest/v1/rev_team_members?')) return Response.json([]);
      return previousFetch(input, init);
    }));
    await expect(configureTeam({ url:'https://example.supabase.co', publishableKey:'sb_publishable_test', accessToken:'valid-other-user', teamId:randomUUID() })).rejects.toThrow('not a member');
  });
  it('fetches without publishing when no sharing checkbox is selected', async () => {
    const preview = await teamPreview({ projectRoot: root });
    const result = await teamSync({ previewId: preview.previewId, projectRoot: root, shareAnalysis: false, sharedRunIds: [], confirm:true });
    expect(result.counts.runsShared).toBe(0);
    expect(result.counts.itemsShared).toBe(0);
    expect(calls).toEqual([]);
  });

  it('rejects stale consent and shares only selected sources, never local paths', async () => {
    const selected = randomUUID(), hidden = randomUUID(), id = randomUUID();
    const run: Run = { id, recipient:'Incoming', projectRoot:root, createdAt:new Date().toISOString(), state:'needs_review',
      artifacts:[{ id:selected, kind:'git_commit', externalId:'a', text:'Allowed excerpt', author:'A', timestamp:null, url:null, sourceRef:'git' },
        { id:hidden, kind:'slack_message', externalId:'b', text:'PRIVATE HIDDEN SOURCE', author:'B', timestamp:null, url:null, sourceRef:'slack' }],
      selectedIds:[selected], warnings:[], items:[], mode:'fixture', revision:1, approvedRevision:null, acceptedPartial:false };
    await createRun(run);
    const preview = await teamPreview({ projectRoot:root });
    expect(preview.runs.some(r => r.runId === id)).toBe(true);
    await expect(teamSync({ previewId:preview.previewId, projectRoot:root, shareAnalysis:false, sharedRunIds:[id], confirm:false })).rejects.toThrow();
    await teamSync({ previewId:preview.previewId, projectRoot:root, shareAnalysis:false, sharedRunIds:[id], confirm:true });
    const sent = calls.find(c => c.p_doc_key === id);
    expect(sent.p_kind).toBe('handover');
    expect(JSON.stringify(sent)).toContain('Allowed excerpt');
    expect(JSON.stringify(sent)).not.toContain('PRIVATE HIDDEN SOURCE');
    expect(JSON.stringify(sent)).not.toContain(root);
  });

  it('imports compatible remote analysis and reuses it without running the analyzer', async () => {
    const { projectKey } = await projectIdentity(root);
    const commit = 'a'.repeat(40);
    const payload = { version:1, projectKey, analyzerVersion:ANALYZER_VERSION, commit,
      report:{ commitSha:commit, authorName:'Alice', authorEmail:'alice@example.test', message:'change', files:[] } };
    remoteRows = [{ document_id:randomUUID(), project_key:projectKey, kind:'analysis', doc_key:`${ANALYZER_VERSION}:${commit}`, version:1, created_by:user, status:'committed', payload }];
    const preview = await teamPreview({ projectRoot:root });
    const result = await teamSync({ previewId:preview.previewId, projectRoot:root, shareAnalysis:false, sharedRunIds:[], confirm:true });
    expect(result.counts.incomingApplied).toBe(1);
    expect(await getOrAnalyzeCommit(root, commit)).toEqual(payload.report);
    expect(calls).toHaveLength(0);
  });

  it('preserves both copies when an incoming run conflicts with local data', async () => {
    const { projectKey } = await projectIdentity(root);
    const id = randomUUID();
    const local: Run = { id, recipient:'Local version', projectRoot:root, createdAt:new Date().toISOString(), state:'needs_review',
      artifacts:[], selectedIds:[], warnings:[], items:[], mode:'fixture', revision:1, approvedRevision:null, acceptedPartial:false };
    await createRun(local);
    const remote = { ...local, projectRoot:undefined, recipient:'Remote version' };
    remoteRows = [{ document_id:randomUUID(), project_key:projectKey, kind:'handover', doc_key:id, version:1, created_by:user, status:'committed', payload:remote }];
    const preview = await teamPreview({ projectRoot:root });
    await teamSync({ previewId:preview.previewId, projectRoot:root, shareAnalysis:false, sharedRunIds:[], confirm:true });
    expect((await getRun(id))?.recipient).toBe('Local version');
    const result = await (await database()).query<{local_payload:Run;remote_payload:Run}>('SELECT local_payload,remote_payload FROM team_sync_conflicts WHERE run_id=$1', [id]);
    expect(result.rows[0].local_payload.recipient).toBe('Local version');
    expect(result.rows[0].remote_payload.recipient).toBe('Remote version');
  });
});

it('fails closed before contacting Supabase while local authorization is incomplete', async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  await expect(configureTeam({ url:'https://example.supabase.co', publishableKey:'sb_publishable_test', accessToken:'session-token', teamId:team })).rejects.toThrow('disabled');
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('restricts hosted Supabase authentication endpoints to the intended origin', () => {
  expect(validateSupabaseProjectUrl('https://project-id.supabase.co')).toBe('https://project-id.supabase.co');
  for (const url of ['http://project-id.supabase.co', 'https://project-id.supabase.co.attacker.example', 'https://user:pass@project-id.supabase.co', 'https://project-id.supabase.co/path', 'https://127.0.0.1']) {
    expect(() => validateSupabaseProjectUrl(url)).toThrow();
  }
});
