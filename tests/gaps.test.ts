import {describe,it,expect} from 'vitest';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {newRun,updateAction,readRun,deleteRun,exportMarkdown} from '@/lib/server/service';
process.env.REV_DATA_DIR=path.join(tmpdir(),`rev-gaps-${process.pid}`);
describe('reviewer gap workflow',()=>{
 it('flags clarification, captures an answer as unselected evidence and requires reapproval',async()=>{
  let run=await newRun({recipient:'dev',fixture:true});const selectedIds=[run.artifacts[0].id];
  run=await updateAction(run.id,{action:'scope',selectedIds});run=await updateAction(run.id,{action:'generate',selectedIds,acceptPartial:false,confirmAuthorisation:true,fixture:true});
  run=await updateAction(run.id,{action:'save',items:run.items.map(item=>({...item,needsClarification:true}))});
  run=await updateAction(run.id,{action:'detect_gaps'});expect(run.gaps).toHaveLength(1);
  const oldQuestion=run.gaps![0].question;
  run=await updateAction(run.id,{action:'save',items:run.items.map(item=>({...item,text:'Edited question context',needsClarification:true}))});
  run=await updateAction(run.id,{action:'detect_gaps'});expect(run.gaps![0].question).not.toBe(oldQuestion);expect(run.gaps![0].question).toContain('Edited question context');
  await expect(updateAction(run.id,{action:'answer_gap',gapId:run.gaps![0].id,answer:'x',selectedIds:[run.artifacts[1].id]})).rejects.toThrow('scope changed');
  run=await updateAction(run.id,{action:'approve',confirmAuthorisation:true});expect(exportMarkdown(run)).toContain('clarification needed');
  const gapId=run.gaps![0].id;
  run=await updateAction(run.id,{action:'answer_gap',gapId,answer:'Ari owns cache recovery.',selectedIds});
  expect(run.state).toBe('awaiting_scope_confirmation');expect(run.selectedIds).toEqual([]);expect(run.items).toEqual([]);expect(()=>exportMarkdown(run)).toThrow('Approve');
  const source=run.artifacts.find(a=>a.kind==='review_answer');expect(source?.text).toBe('Ari owns cache recovery.');
  const persisted=await readRun(run.id);expect(persisted.artifacts.some(a=>a.id===source?.id)).toBe(true);
  await deleteRun(run.id);
 });
});
