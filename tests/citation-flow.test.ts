import {describe,it,expect} from 'vitest';
import {tmpdir} from 'node:os';import path from 'node:path';
import {newRun,updateAction,deleteRun,exportMarkdown} from '@/lib/server/service';
process.env.REV_DATA_DIR=path.join(tmpdir(),`rev-citation-flow-${process.pid}`);
describe('citation repair workflow',()=>{
 it('requires selected exact evidence and invalidates a prior approval',async()=>{
  let run=await newRun({recipient:'dev',fixture:true});const selectedIds=[run.artifacts[0].id];run=await updateAction(run.id,{action:'scope',selectedIds});run=await updateAction(run.id,{action:'generate',selectedIds,acceptPartial:false,confirmAuthorisation:true,fixture:true});
  run=await updateAction(run.id,{action:'save',items:run.items.map(i=>({...i,text:'Edited claim'}))});run=await updateAction(run.id,{action:'approve',confirmAuthorisation:true});
  await expect(updateAction(run.id,{action:'attach_citations',itemId:run.items[0].id,selectedIds,references:[{sourceId:selectedIds[0],quote:'invented'}]})).rejects.toThrow('not found');
  run=await updateAction(run.id,{action:'attach_citations',itemId:run.items[0].id,selectedIds,references:[{sourceId:selectedIds[0],quote:run.artifacts[0].text}]});
  expect(run.state).toBe('needs_review');expect(run.items[0].needsClarification).toBe(true);expect(()=>exportMarkdown(run)).toThrow('Approve');
  run=await updateAction(run.id,{action:'approve',confirmAuthorisation:true});expect(exportMarkdown(run)).toContain('Edited claim');
  await deleteRun(run.id);
 });
});
