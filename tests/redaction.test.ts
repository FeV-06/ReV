import {describe,it,expect} from 'vitest';
import {tmpdir} from 'node:os';import path from 'node:path';
import {newRun,updateAction,deleteRun,readRun} from '@/lib/server/service';
import {database} from '@/lib/server/store';
process.env.REV_DATA_DIR=path.join(tmpdir(),`rev-redaction-audit-${process.pid}`);
describe('source redaction with retained provenance',()=>{
 it('creates an unselected redacted snapshot and records a safe source lineage',async()=>{
  let run=await newRun({recipient:'dev',fixture:true});const selectedIds=[run.artifacts[0].id];run=await updateAction(run.id,{action:'scope',selectedIds});
  const source=run.artifacts[0];run=await updateAction(run.id,{action:'redact_source',sourceId:source.id,quote:'Redis',selectedIds});
  expect(run.state).toBe('awaiting_scope_confirmation');expect(run.selectedIds).toEqual([]);
  const redacted=run.artifacts.find(a=>a.kind==='review_redaction')!;expect(redacted.text).not.toContain('Redis');expect(redacted.text).toContain('[REDACTED]');
  const db=await database();const events=await db.query<{event:{parentSourceId:string;redactedSourceId:string}}>('SELECT event FROM source_events WHERE run_id=$1',[run.id]);expect(events.rows[0].event.parentSourceId).toBe(source.id);expect(events.rows[0].event.redactedSourceId).toBe(redacted.id);
  expect((await readRun(run.id)).artifacts.some(a=>a.id===source.id)).toBe(true);await deleteRun(run.id);
 });
});
