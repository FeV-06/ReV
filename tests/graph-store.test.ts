import { describe,it,expect } from 'vitest';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {newRun,updateAction,readGraph,deleteRun} from '@/lib/server/service';
process.env.REV_DATA_DIR=path.join(tmpdir(),`rev-event-log-${process.pid}`);
describe('durable graph event log',()=>{
 it('replays selected scope, preserves history and cascades deletion',async()=>{
  let run=await newRun({recipient:'event-test',fixture:true});const selectedIds=[run.artifacts[0].id];
  run=await updateAction(run.id,{action:'scope',selectedIds});run=await updateAction(run.id,{action:'generate',selectedIds,acceptPartial:false,confirmAuthorisation:true,fixture:true});
  const first=await readGraph(run.id);expect(first.edges.length).toBeGreaterThan(0);
  run=await updateAction(run.id,{action:'graph_review',edgeId:first.edges[0].id,decision:'confirmed'});
  expect((await readGraph(run.id)).edges[0].status).toBe('confirmed');
  await deleteRun(run.id);
  await expect(readGraph(run.id)).rejects.toThrow('not found');
 });
});
