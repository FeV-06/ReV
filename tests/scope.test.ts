import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newRun, updateAction, readRun, deleteRun, exportMarkdown } from '@/lib/server/service';
import { database } from '@/lib/server/store';

process.env.REV_DATA_DIR = path.join(tmpdir(), `rev-scope-${process.pid}`);

describe('server-side source scope',()=>{
  it('invalidates approval immediately on scope change and records all model inputs',async()=>{
    let run=await newRun({recipient:'Engineer',fixture:true});
    const selectedIds=run.artifacts.slice(0,2).map(a=>a.id);
    run=await updateAction(run.id,{action:'scope',selectedIds});
    run=await updateAction(run.id,{action:'generate',selectedIds,acceptPartial:false,confirmAuthorisation:true,fixture:true});
    expect(run.items.length).toBeGreaterThan(0);
    expect(run.items[0].derivationSourceIds).toEqual(selectedIds);
    run=await updateAction(run.id,{action:'approve',confirmAuthorisation:true});
    expect(exportMarkdown(run)).toContain('Handover');
    run=await updateAction(run.id,{action:'scope',selectedIds:[selectedIds[0]]});
    expect(run.state).toBe('awaiting_scope_confirmation');
    expect(run.items).toEqual([]);
    expect(()=>exportMarkdown(run)).toThrow('Approve');
    const persisted=await readRun(run.id); expect(persisted.selectedIds).toEqual([selectedIds[0]]);
    await deleteRun(run.id);
  });
  it('allows only one concurrent approval and retains one immutable snapshot',async()=>{
    let run=await newRun({recipient:'Engineer',fixture:true});
    const selectedIds=[run.artifacts[0].id];
    run=await updateAction(run.id,{action:'scope',selectedIds});
    run=await updateAction(run.id,{action:'generate',selectedIds,acceptPartial:false,confirmAuthorisation:true,fixture:true});
    const results=await Promise.allSettled([
      updateAction(run.id,{action:'approve',confirmAuthorisation:true}),
      updateAction(run.id,{action:'approve',confirmAuthorisation:true}),
    ]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const snapshots=await (await database()).query('SELECT revision FROM approved_revisions WHERE run_id = $1',[run.id]);
    expect(snapshots.rows).toHaveLength(1);
    await deleteRun(run.id);
  });
});
