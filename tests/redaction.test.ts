import {describe,it,expect} from 'vitest';
import {tmpdir} from 'node:os';import path from 'node:path';
import {newRun,updateAction,deleteRun,readRun,readGraph,exportMarkdown} from '@/lib/server/service';
import {database,exportArchive} from '@/lib/server/store';
import {validateArchive} from '@/lib/server/archive';
process.env.REV_DATA_DIR=path.join(tmpdir(),`rev-redaction-audit-${process.pid}`);
describe('source redaction with retained provenance',()=>{
 it('creates an unselected redacted snapshot and records a safe source lineage',async()=>{
  let run=await newRun({recipient:'dev',fixture:true});const selectedIds=[run.artifacts[0].id];run=await updateAction(run.id,{action:'scope',selectedIds});
  const source=run.artifacts[0];
  await expect(updateAction(run.id,{action:'redact_source',sourceId:source.id,quote:'not present',selectedIds})).rejects.toThrow('not found');
  await expect(updateAction(run.id,{action:'redact_source',sourceId:source.id,quote:'Redis',selectedIds:[run.artifacts[1].id]})).rejects.toThrow('scope changed');
  run=await updateAction(run.id,{action:'generate',selectedIds,acceptPartial:false,confirmAuthorisation:true,fixture:true});
  run=await updateAction(run.id,{action:'approve',confirmAuthorisation:true});
  const previousExport=exportMarkdown(run);expect(previousExport).toContain('Redis');
  run=await updateAction(run.id,{action:'redact_source',sourceId:source.id,quote:'Redis',selectedIds});
  expect(run.state).toBe('awaiting_scope_confirmation');expect(run.selectedIds).toEqual([]);
  expect(()=>exportMarkdown(run)).toThrow('Approve');expect((await readGraph(run.id)).edges).toHaveLength(0);
  const redacted=run.artifacts.find(a=>a.kind==='review_redaction')!;expect(redacted.text).not.toContain('Redis');expect(redacted.text).toContain('[REDACTED]');
  const db=await database();const events=await db.query<{event:{parentSourceId:string;redactedSourceId:string}}>('SELECT event FROM source_events WHERE run_id=$1',[run.id]);expect(events.rows[0].event.parentSourceId).toBe(source.id);expect(events.rows[0].event.redactedSourceId).toBe(redacted.id);
  let persisted=await readRun(run.id);expect(persisted.artifacts.some(a=>a.id===source.id)).toBe(true);expect(persisted.sourceEvents).toHaveLength(1);
  const revisedSelection=[redacted.id];persisted=await updateAction(run.id,{action:'scope',selectedIds:revisedSelection});
  persisted=await updateAction(run.id,{action:'generate',selectedIds:revisedSelection,acceptPartial:false,confirmAuthorisation:true,fixture:true});
  persisted=await updateAction(run.id,{action:'approve',confirmAuthorisation:true});
  expect(exportMarkdown(persisted)).not.toContain('Redis');expect(exportMarkdown(persisted)).toContain('REDACTED');
  const archive=validateArchive(await exportArchive());expect(archive.sourceEvents?.some(e=>e.event.redactedSourceId===redacted.id)).toBe(true);
  await deleteRun(run.id);
  expect((await db.query('SELECT 1 FROM source_events WHERE run_id=$1',[run.id])).rows).toHaveLength(0);
 });
 it('keeps redaction and original approval unchanged if concurrent writes race',async()=>{
  let run=await newRun({recipient:'concurrency-test',fixture:true});const selectedIds=[run.artifacts[0].id];
  run=await updateAction(run.id,{action:'scope',selectedIds});run=await updateAction(run.id,{action:'generate',selectedIds,acceptPartial:false,confirmAuthorisation:true,fixture:true});run=await updateAction(run.id,{action:'approve',confirmAuthorisation:true});
  const outcomes=await Promise.allSettled(Array.from({length:2},()=>updateAction(run.id,{action:'redact_source',sourceId:selectedIds[0],quote:'Redis',selectedIds})));
  expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);const persisted=await readRun(run.id);
  expect(persisted.artifacts.filter(a=>a.kind==='review_redaction')).toHaveLength(1);expect(persisted.sourceEvents).toHaveLength(1);expect(persisted.approvedRevision).toBeNull();
  await deleteRun(run.id);
 });
});
