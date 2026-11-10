import {describe,it,expect} from 'vitest';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {askHandover,newRun,updateAction,readRun,deleteRun,exportMarkdown} from '@/lib/server/service';
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
  expect(run.state).toBe('needs_review');expect(run.selectedIds).toEqual(selectedIds);expect(run.items).toHaveLength(1);expect(()=>exportMarkdown(run)).toThrow('Approve');
  const source=run.artifacts.find(a=>a.kind==='review_answer');expect(source?.text).toBe('Ari owns cache recovery.');
  const persisted=await readRun(run.id);expect(persisted.artifacts.some(a=>a.id===source?.id)).toBe(true);
  await deleteRun(run.id);
 });
});

it('queues an unanswered question and only uses the reply after the lead shares it', async () => {
  let run = await newRun({ recipient: 'dev', departingPerson: 'Ari', fixture: true });
  const id = run.id;
  const selectedIds = [run.artifacts[0].id];
  const question = 'Who signs the emergency failover authorization?';
  try {
    run = await updateAction(id, { action: 'scope', selectedIds });
    run = await updateAction(id, { action: 'generate', selectedIds, acceptPartial: false, confirmAuthorisation: true, fixture: true });
    const originalItems = run.items;
    await expect(askHandover(id, { question })).rejects.toThrow('approve');
    await updateAction(id, { action: 'approve', confirmAuthorisation: true });
    expect(await askHandover(id, { question })).toMatchObject({ answer: null, followUp: question });
    await askHandover(id, { question });
    run = await readRun(id);
    expect(run.gaps).toHaveLength(1);
    expect(run.state).toBe('approved');
    run = await updateAction(id, {
      action: 'answer_gap', gapId: run.gaps![0].id, author: 'Ari', answer: 'The incident commander signs it.', selectedIds,
    });
    expect(run.items).toEqual(originalItems);
    expect(run.selectedIds).toEqual(selectedIds);
    const answerId = run.gaps![0].answerSourceId!;
    run = await updateAction(id, { action: 'approve', confirmAuthorisation: true });
    expect(exportMarkdown(run)).not.toContain('incident commander');
    expect(await askHandover(id, { question })).toMatchObject({ answer: null });
    run = await readRun(id);
    expect(run.gaps).toHaveLength(1);
    // A lead can share a reviewed answer after approving the rest of the handover.
    await updateAction(id, { action: 'approve', confirmAuthorisation: true, interviewAnswerIds: [answerId] });
    expect(await askHandover(id, { question })).toMatchObject({
      answer: 'The incident commander signs it.', followUp: null, citations: [{ sourceId: answerId, author: 'Ari' }],
    });
  } finally {
    await deleteRun(id);
  }
});
