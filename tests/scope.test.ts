import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newRun, updateAction, readRun, readGraph, deleteRun, exportMarkdown } from '@/lib/server/service';
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
  it('stores relationship review events, invalidates approval and hides graph on scope change',async()=>{
    let run=await newRun({recipient:'Engineer',fixture:true});const selectedIds=run.artifacts.slice(0,2).map(a=>a.id);
    run=await updateAction(run.id,{action:'scope',selectedIds});
    run=await updateAction(run.id,{action:'generate',selectedIds,acceptPartial:false,confirmAuthorisation:true,fixture:true});
    run=await updateAction(run.id,{action:'approve',confirmAuthorisation:true});
    expect((await readGraph(run.id)).edges.length).toBeGreaterThan(0);
    run=await updateAction(run.id,{action:'graph_propose',fromId:selectedIds[0],toId:run.items[0].id,type:'contradicts',evidenceSourceIds:[selectedIds[0]]});
    expect(run.state).toBe('needs_review');expect(run.approvedRevision).toBeNull();
    const initialCount=run.graphEvents!.length;const edgeId=run.graphEvents!.at(-1)!.edge.id;
    run=await updateAction(run.id,{action:'graph_review',edgeId,decision:'confirmed'});
    expect(run.graphEvents).toHaveLength(initialCount+1);expect(run.graphEvents!.at(-1)!.edge.status).toBe('confirmed');
    run=await updateAction(run.id,{action:'scope',selectedIds:[selectedIds[0]]});expect(run.graphEvents).toHaveLength(0);expect((await readGraph(run.id)).edges).toHaveLength(0);
    const raw=await (await database()).query<{payload:{graphEvents:unknown[]}}>('SELECT payload FROM runs WHERE id = $1',[run.id]);
    expect(raw.rows[0].payload.graphEvents).toHaveLength(initialCount+1);
    run=await updateAction(run.id,{action:'scope',selectedIds});expect((await readGraph(run.id)).edges).toHaveLength(0);
    await deleteRun(run.id);
  });
  it('invalidates graph relationships when a linked claim is edited',async()=>{
    let run=await newRun({recipient:'Engineer',fixture:true});const selectedIds=[run.artifacts[0].id];
    run=await updateAction(run.id,{action:'scope',selectedIds});run=await updateAction(run.id,{action:'generate',selectedIds,acceptPartial:false,confirmAuthorisation:true,fixture:true});
    run=await updateAction(run.id,{action:'graph_review',edgeId:run.graphEvents![0].edge.id,decision:'confirmed'});
    run=await updateAction(run.id,{action:'save',items:run.items.map(i=>({...i,text:'Different claim'}))});
    expect((await readGraph(run.id)).edges).toHaveLength(0);expect(run.graphEvents).toHaveLength(0);
    await deleteRun(run.id);
  });
});
