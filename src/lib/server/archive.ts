import { Client } from 'pg';
import { z } from 'zod';
import { runSchema, graphEventSchema } from '@/lib/contracts';

const archiveSchema=z.object({version:z.literal(1),runs:z.array(runSchema),approved:z.array(z.object({runId:z.string().uuid(),revision:z.number().int(),approvedAt:z.string(),payload:runSchema})),events:z.array(z.object({runId:z.string().uuid(),event:graphEventSchema}))});
export type RunArchive=z.infer<typeof archiveSchema>;

/** Offline, explicit snapshot transfer; does not implement live sync or user authorization. */
export function validateArchive(value:unknown):RunArchive {
 const archive=archiveSchema.parse(value);const ids=new Set(archive.runs.map(r=>r.id));
 if(ids.size!==archive.runs.length)throw new Error('Archive contains duplicate run IDs');
 if(archive.approved.some(r=>!ids.has(r.runId)||r.payload.id!==r.runId||r.payload.revision!==r.revision)||archive.events.some(e=>!ids.has(e.runId)))throw new Error('Archive has orphaned or inconsistent records');
 if(new Set(archive.events.map(e=>e.event.id)).size!==archive.events.length)throw new Error('Archive contains duplicate event IDs');
 return archive;
}

/** Import only into an empty, operator-controlled Postgres database. */
export async function importToPostgres(connectionString:string,input:unknown,confirmed:boolean):Promise<{runs:number;events:number;approved:number}>{
 if(confirmed!==true)throw new Error('Explicit confirmation is required before copying local project data to PostgreSQL');
 const archive=validateArchive(input);const url=new URL(connectionString);
 if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('Expected PostgreSQL URL');
 const client=new Client({connectionString});await client.connect();
 try {
  await client.query('BEGIN');
  await client.query(`CREATE TABLE IF NOT EXISTS runs (id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL, version BIGINT NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS approved_revisions (run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,revision INTEGER NOT NULL,approved_at TIMESTAMPTZ NOT NULL,payload JSONB NOT NULL,PRIMARY KEY(run_id,revision));
  CREATE TABLE IF NOT EXISTS graph_events (seq BIGSERIAL PRIMARY KEY,run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,event_id UUID NOT NULL UNIQUE,event JSONB NOT NULL);`);
  await client.query('LOCK TABLE runs, approved_revisions, graph_events IN ACCESS EXCLUSIVE MODE');
  const count=await client.query('SELECT (SELECT count(*) FROM runs)+(SELECT count(*) FROM approved_revisions)+(SELECT count(*) FROM graph_events) AS n');if(Number(count.rows[0].n)!==0)throw new Error('Target database is not empty; refusing to merge or overwrite');
  for(const run of archive.runs){const {graphEvents,...payload}=run;await client.query('INSERT INTO runs(id,created_at,payload) VALUES($1,$2,$3::jsonb)',[run.id,run.createdAt,JSON.stringify(payload)]);}
  for(const row of archive.approved)await client.query('INSERT INTO approved_revisions(run_id,revision,approved_at,payload) VALUES($1,$2,$3,$4::jsonb)',[row.runId,row.revision,row.approvedAt,JSON.stringify(row.payload)]);
  for(const row of archive.events)await client.query('INSERT INTO graph_events(run_id,event_id,event) VALUES($1,$2,$3::jsonb)',[row.runId,row.event.id,JSON.stringify(row.event)]);
  await client.query('COMMIT');return {runs:archive.runs.length,events:archive.events.length,approved:archive.approved.length};
 } catch(error){await client.query('ROLLBACK');throw error;} finally {await client.end();}
}
