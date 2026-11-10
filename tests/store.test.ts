import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { approveRun, compareAndUpdate, createRun, database, deleteRun, getVersionedRun, listRuns } from '@/lib/server/store';
import type { Run } from '@/lib/contracts';

process.env.REV_DATA_DIR = path.join(tmpdir(), `rev-vitest-${process.pid}`);
describe('persistent optimistic transitions',()=>{
  it('retains both workspace and successor identity in run summaries', async () => {
    const id = randomUUID();
    const run: Run = {id, recipient:'Fixture', projectRoot:'/example/workspace', successorEmail:'dev@example.test', createdAt:new Date().toISOString(), state:'needs_review', artifacts:[], warnings:[], selectedIds:[], items:[], mode:'fixture', revision:1, approvedRevision:null, acceptedPartial:false};
    await createRun(run);
    try {
      expect((await listRuns()).find(item => item.id === id)).toMatchObject({ projectRoot: '/example/workspace', successorEmail: 'dev@example.test' });
    } finally {
      await deleteRun(id);
    }
  });
  it('rejects stale writes and retains immutable approved revisions',async()=>{
    const id=randomUUID();
    const run:Run={id,recipient:'Fixture',createdAt:new Date().toISOString(),state:'needs_review',artifacts:[],warnings:[],selectedIds:[],items:[],mode:'fixture',revision:1,approvedRevision:null,acceptedPartial:false};
    await createRun(run);
    const first=await getVersionedRun(id); expect(first).not.toBeNull();
    const next={...run,state:'approved' as const,approvedRevision:1};
    await approveRun(next,first!.version);
    await expect(compareAndUpdate({...run,recipient:'stale'},first!.version)).rejects.toThrow('changed in another request');
    const fresh=await getVersionedRun(id); expect(fresh?.run.state).toBe('approved');
    await compareAndUpdate({...fresh!.run,recipient:'changed',state:'needs_review',revision:2,approvedRevision:null},fresh!.version);
    const db=await database();const result=await db.query<{payload:Run}>('SELECT payload FROM approved_revisions WHERE run_id = $1',[id]);
    expect(result.rows).toHaveLength(1);expect(result.rows[0].payload.recipient).toBe('Fixture');
    await deleteRun(id);const deleted=await db.query('SELECT 1 FROM approved_revisions WHERE run_id = $1',[id]);expect(deleted.rows).toHaveLength(0);
  });
});
