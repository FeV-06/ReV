import { describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {newRun,updateAction,deleteRun} from '@/lib/server/service';
import {exportArchive} from '@/lib/server/store';
import {validateArchive,importToPostgres} from '@/lib/server/archive';
import {Client} from 'pg';
process.env.REV_DATA_DIR=path.join(tmpdir(),`rev-archive-${process.pid}`);
describe('portable archive',()=>{
 it('exports a consistent local snapshot including approved revisions and graph events',async()=>{
  let run=await newRun({recipient:'archive-test',fixture:true});const selectedIds=[run.artifacts[0].id];
  run=await updateAction(run.id,{action:'scope',selectedIds});run=await updateAction(run.id,{action:'generate',selectedIds,acceptPartial:false,confirmAuthorisation:true,fixture:true});run=await updateAction(run.id,{action:'approve',confirmAuthorisation:true});
  const archive=validateArchive(await exportArchive());expect(archive.runs.some(r=>r.id===run.id)).toBe(true);expect(archive.approved.some(r=>r.runId===run.id)).toBe(true);expect(archive.events.some(r=>r.runId===run.id)).toBe(true);
  await deleteRun(run.id);
 });
 it('rejects orphaned events rather than importing inconsistent state',()=>expect(()=>validateArchive({version:1,runs:[],approved:[],events:[{runId:randomUUID(),event:{id:randomUUID(),type:'edge_proposed',at:new Date().toISOString(),edge:{id:randomUUID(),fromId:randomUUID(),toId:randomUUID(),type:'supports',evidenceSourceIds:[randomUUID()],status:'proposed',createdAt:new Date().toISOString()}}}]})).toThrow('orphaned'));
 it.skipIf(!process.env.REV_TEST_POSTGRES_URL)('imports into a real empty PostgreSQL database and refuses overwrite',async()=>{
  const url=process.env.REV_TEST_POSTGRES_URL!;
  let run=await newRun({recipient:'postgres-archive-test',fixture:true});const selectedIds=[run.artifacts[0].id];
  run=await updateAction(run.id,{action:'scope',selectedIds});run=await updateAction(run.id,{action:'generate',selectedIds,acceptPartial:false,confirmAuthorisation:true,fixture:true});run=await updateAction(run.id,{action:'approve',confirmAuthorisation:true});
  run=await updateAction(run.id,{action:'redact_source',sourceId:selectedIds[0],quote:'Redis',selectedIds});
  const archive=validateArchive(await exportArchive());await expect(importToPostgres(url,archive,false)).rejects.toThrow('Explicit confirmation');const receipt=await importToPostgres(url,archive,true);expect(receipt.runs).toBeGreaterThan(0);expect(receipt.events).toBeGreaterThan(0);
  const client=new Client({connectionString:url});await client.connect();
  try {const row=await client.query('SELECT payload FROM runs WHERE id=$1',[run.id]);expect(row.rows[0].payload.recipient).toBe('postgres-archive-test');const sourceEvents=await client.query('SELECT event FROM source_events WHERE run_id=$1',[run.id]);expect(sourceEvents.rows[0].event.type).toBe('source_redacted');await expect(importToPostgres(url,archive,true)).rejects.toThrow('not empty');}
  finally {await client.end();await deleteRun(run.id);}
 });
});
