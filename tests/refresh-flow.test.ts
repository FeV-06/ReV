import {describe,it,expect} from 'vitest';
import {tmpdir} from 'node:os';import path from 'node:path';
import {newRun,updateAction,readRun,deleteRun,refreshRun,exportMarkdown} from '@/lib/server/service';
process.env.REV_DATA_DIR=path.join(tmpdir(),`rev-refresh-flow-${process.pid}`);
describe('persisted on-demand refresh',()=>{
 it('creates a separate snapshot, invalidates approval and excludes changed records',async()=>{
  let old=await newRun({recipient:'dev',fixture:true});const selected=[old.artifacts[0].id];old=await updateAction(old.id,{action:'scope',selectedIds:selected});old=await updateAction(old.id,{action:'generate',selectedIds:selected,acceptPartial:false,confirmAuthorisation:true,fixture:true});old=await updateAction(old.id,{action:'approve',confirmAuthorisation:true});
  const incoming=old.artifacts.map(a=>a.id===selected[0]?{...a,text:'modified source'}:a);
  await expect(refreshRun(old.id,{sources:incoming,revokedIds:[],expectedRevision:old.revision})).rejects.toThrow('atomic invalidation');
  const next=await refreshRun(old.id,{sources:old.artifacts,revokedIds:[],expectedRevision:old.revision});
  expect(next.id).not.toBe(old.id);expect(next.items).toEqual([]);expect(next.selectedIds).toContain(selected[0]);expect(()=>exportMarkdown(next)).toThrow('Approve');
  expect((await readRun(old.id)).state).toBe('approved');expect(exportMarkdown(await readRun(old.id))).toContain('Handover');
  await deleteRun(next.id);await deleteRun(old.id);
 });
});
