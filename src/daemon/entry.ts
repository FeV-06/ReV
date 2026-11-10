import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { chmod, mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';

import { readJsonLimited } from '@/lib/server/body';
import { askHandover, newRun, updateAction, readRun, readGraph, exportMarkdown, refreshRun, deleteRun, listRuns, clientError } from '@/lib/server/service';
import { closeDatabase, database } from '@/lib/server/store';
import { getProject, listProjects, registerProject, removeProject, setProjectPaused } from '@/lib/server/projects';
import { listProjectSnapshots, readLatestSnapshot, scanProject } from '@/lib/server/capture';
import { connectedSources } from '@/lib/server/sources';
import { syncToSupabase, testPostgresConnection } from '@/lib/server/sync-supabase';
import { loadSettings } from '@/lib/server/settings';

try {
  process.loadEnvFile('.env.local');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const host='127.0.0.1';
const requestedPort=Number(process.env.REV_DAEMON_PORT ?? '3078');
if(!Number.isInteger(requestedPort)||requestedPort<0||requestedPort>65535)throw new Error('REV_DAEMON_PORT must be a valid port');
const dataDir=path.resolve(process.env.REV_DATA_DIR || '.rev-data');
process.env.REV_DATA_DIR=dataDir;
const lockPath=path.join(dataDir,'daemon.lock');
const lockOwnerPath=path.join(lockPath,'owner.json');
const tokenPath=path.join(dataDir,'daemon.token');
const statePath=path.join(dataDir,'daemon.json');
const token=randomBytes(32).toString('hex');
const launchNonce=randomBytes(16).toString('hex');
let activePort=0;
let closing=false;
let lockOwned=false;
const MAX_ACTIVE=8;
let active=0;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function acquireLock():Promise<void> {
  try { await mkdir(lockPath,{mode:0o700});lockOwned=true; }
  catch(error) {
    if((error as NodeJS.ErrnoException).code==='EEXIST') {
      try {
        const ownerJson = await readFile(lockOwnerPath, 'utf8');
        const owner = JSON.parse(ownerJson) as { pid?: number };
        if (typeof owner.pid === 'number' && !isProcessAlive(owner.pid)) {
          process.stderr.write(`[daemon] Cleaning up stale lock from dead PID ${owner.pid}\\n`);
          await rm(lockOwnerPath, { force: true });
          await rmdir(lockPath);
          await mkdir(lockPath, { mode: 0o700 });
          lockOwned = true;
        } else {
          throw new Error(`A ReV daemon is already using this data directory (PID ${owner.pid ?? 'unknown'})`);
        }
      } catch (inner) {
        if ((inner as Error).message.includes('already using this data directory')) throw inner;
        throw new Error('A ReV daemon is already using this data directory, or a stale daemon lock requires inspection');
      }
    } else {
      throw error;
    }
  }
  await writeFile(lockOwnerPath,JSON.stringify({protocol:1,pid:process.pid,nonce:launchNonce})+'\n',{mode:0o600,flag:'wx'});
}
async function releaseLock():Promise<void> {
  if(!lockOwned)return;
  const owner=JSON.parse(await readFile(lockOwnerPath,'utf8')) as {pid?:number;nonce?:string};
  if(owner.pid!==process.pid||owner.nonce!==launchNonce)throw new Error('Daemon lock ownership changed; refusing to remove it');
  await rm(lockOwnerPath);await rmdir(lockPath);lockOwned=false;
}

function equalToken(value:string|undefined):boolean {
  if(!value?.startsWith('Bearer '))return false;
  const actual=Buffer.from(value.slice(7));const expected=Buffer.from(token);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
function json(res:ServerResponse,status:number,value:unknown):void {
  const body=JSON.stringify(value);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(body);
}
function blocked(req:IncomingMessage):number|undefined {
  if(req.headers.host!==`${host}:${activePort}`)return 403;
  if(req.headers.origin!==undefined||req.headers['sec-fetch-site']!==undefined)return 403;
  if(!equalToken(req.headers.authorization))return 401;
  return undefined;
}
function uuid(value:string):string{return z.string().uuid().parse(value);}
async function body(req:IncomingMessage,limit:number):Promise<unknown> {
  const headers=new Headers();for(const [key,val] of Object.entries(req.headers))if(typeof val==='string')headers.set(key,val);
  const web=new Request(`http://${host}:${activePort}/`,{method:req.method,headers,body:Readable.toWeb(req) as ReadableStream,duplex:'half'} as RequestInit & {duplex:'half'});
  return readJsonLimited(web,limit);
}
async function route(req:IncomingMessage,res:ServerResponse):Promise<void> {
  const code=blocked(req);if(code){json(res,code,{error:code===401?'Unauthorized':'Forbidden'});return;}
  if(closing){json(res,503,{error:'Daemon is shutting down'});return;}
  if(active>=MAX_ACTIVE){json(res,503,{error:'Daemon is busy; retry later'});return;}
  active++;
  try {
    const url=new URL(req.url || '/',`http://${host}:${activePort}`);if(url.search||url.hash){json(res,400,{error:'Query parameters are not supported'});return;}
    if(req.method==='GET'&&url.pathname==='/v1/health'){json(res,200,{status:'ok',protocol:1});return;}
    if(req.method==='POST'&&url.pathname==='/v1/shutdown'){json(res,200,{ok:true});setImmediate(()=>void shutdown());return;}
    if(url.pathname==='/v1/projects'){
      if(req.method==='GET'){
        const projects=await listProjects();
        const enriched=await Promise.all(projects.map(async p=>({...p,snapshot:await readLatestSnapshot(p.id)})));
        json(res,200,{projects:enriched});
        return;
      }
      if(req.method==='POST'){json(res,201,{project:await registerProject(await body(req,32_000))});return;}
    }
    const projectMatch=/^\/v1\/projects\/([0-9a-fA-F-]+)(?:\/(scan|snapshots))?$/.exec(url.pathname);
    if(projectMatch){
      const id=uuid(projectMatch[1]);
      const sub=projectMatch[2];
      if(!sub){
        if(req.method==='GET'){json(res,200,{project:await getProject(id),snapshot:await readLatestSnapshot(id)});return;}
        if(req.method==='PATCH'){const args=z.object({paused:z.boolean()}).strict().parse(await body(req,4_000));json(res,200,{project:await setProjectPaused(id,args.paused)});return;}
        if(req.method==='DELETE'){await removeProject(id);json(res,200,{ok:true});return;}
        json(res,405,{error:'Method not allowed'});return;
      }
      if(sub==='scan'){
        if(req.method==='POST'){json(res,200,{snapshot:await scanProject(id)});return;}
        json(res,405,{error:'Method not allowed'});return;
      }
      if(sub==='snapshots'){
        if(req.method==='GET'){json(res,200,{snapshots:await listProjectSnapshots(id)});return;}
        json(res,405,{error:'Method not allowed'});return;
      }
    }
    if(url.pathname==='/v1/runs'){
      if(req.method==='GET'){json(res,200,{runs:await listRuns(),sources:await connectedSources()});return;}
      if(req.method==='POST'){json(res,201,{run:await newRun(await body(req,15_000_000))});return;}
    }
    if(url.pathname==='/v1/sync/supabase'&&req.method==='POST'){
      const args=await body(req,64_000);
      const parsed=z.object({testOnly:z.boolean().optional(),confirmSync:z.boolean().optional(),connectionString:z.string().max(2_000).optional(),runId:z.string().uuid().optional()}).strict().safeParse(args);
      if(!parsed.success){json(res,400,{error:'Invalid sync request'});return;}
      const payload=parsed.data;
      const savedSettings=await loadSettings();
      const connectionString=
        (payload.connectionString??'').trim()||
        savedSettings.postgresUri.trim()||
        process.env.SUPABASE_DB_URL||
        process.env.DATABASE_URL||
        '';
      if(payload.testOnly===true){
        // Connection check only: never uploads data and does not require sync consent.
        if(!connectionString){json(res,400,{success:false,error:'No connection string provided'});return;}
        const testResult=await testPostgresConnection(connectionString);
        json(res,testResult.success?200:400,testResult);
        return;
      }
      // Data upload requires the explicit, literal consent flag; nothing is sent without it.
      if(payload.confirmSync!==true){json(res,403,{success:false,error:'Explicit cloud sync consent is required (confirmSync: true). Data remains local in PGlite.'});return;}
      if(!connectionString){
        json(res,200,{success:false,fallback:'local',error:'No Supabase connection configured. Data remains safe in local PGlite.',timestamp:new Date().toISOString()});
        return;
      }
      const result=await syncToSupabase(connectionString,payload.runId);
      json(res,result.success?200:400,result);
      return;
    }
    const match=/^\/v1\/runs\/([0-9a-fA-F-]+)(?:\/(graph|export|refresh|ask))?$/.exec(url.pathname);
    if(!match){json(res,404,{error:'Not found'});return;}
    const id=uuid(match[1]);const action=match[2];
    if(!action&&req.method==='GET'){json(res,200,{run:await readRun(id)});return;}
    if(!action&&req.method==='PATCH'){json(res,200,{run:await updateAction(id,await body(req,15_000_000))});return;}
    if(!action&&req.method==='DELETE'){await readRun(id);await deleteRun(id);json(res,200,{ok:true});return;}
    if(action==='ask'&&req.method==='POST'){json(res,200,await askHandover(id,await body(req,8_000)));return;}
    if(action==='graph'&&req.method==='GET'){json(res,200,{graph:await readGraph(id)});return;}
    if(action==='refresh'&&req.method==='POST'){json(res,200,{run:await refreshRun(id,await body(req,4_000_000))});return;}
    if(action==='export'&&req.method==='GET'){
      const result=exportMarkdown(await readRun(id));res.writeHead(200,{'content-type':'text/markdown; charset=utf-8','content-disposition':'attachment; filename="rev-handover.md"','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(result);return;
    }
    json(res,405,{error:'Method not allowed'});
  } catch(error){json(res,400,{error:clientError(error)});} finally {active--;}
}
const server=createServer((req,res)=>{void route(req,res);});
server.requestTimeout=160_000;server.headersTimeout=15_000;

const captureIntervalMs=Number(process.env.REV_CAPTURE_INTERVAL_MS ?? '5000');
let captureTimer:NodeJS.Timeout|null=null;
let capturing=false;
async function tickCapture():Promise<void> {
  if(capturing||closing)return;capturing=true;
  try {
    const projects=await listProjects();
    for(const p of projects){
      if(p.paused||closing)continue;
      try {await scanProject(p.id);}
      catch(err){process.stderr.write(`[capture] Scan failed for ${p.root}: ${err instanceof Error?err.message:'unknown error'}\n`);}
    }
  } catch {}
  finally {capturing=false;}
}
function startCaptureLoop():void {
  if(captureTimer||captureIntervalMs<=0)return;
  captureTimer=setInterval(()=>void tickCapture(),captureIntervalMs);
}
function stopCaptureLoop():void {
  if(captureTimer){clearInterval(captureTimer);captureTimer=null;}
}

async function shutdown():Promise<void> {
  if(closing)return;closing=true;
  stopCaptureLoop();
  try {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await closeDatabase();
    await Promise.all([rm(statePath,{force:true}),rm(tokenPath,{force:true})]);
    await releaseLock();
  } catch(error){process.stderr.write(`ReV daemon shutdown failed: ${error instanceof Error?error.message:'unknown error'}\n`);process.exitCode=1;}
}
async function main():Promise<void> {
  await mkdir(dataDir,{recursive:true,mode:0o700});
  let databaseOpened=false;
  try {
    await acquireLock();
    await database();databaseOpened=true;
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(requestedPort,host,()=>{server.off('error',reject);resolve();});});
    const address=server.address();if(!address||typeof address==='string')throw new Error('Daemon did not bind a TCP port');activePort=address.port;
    await writeFile(tokenPath,token+'\n',{mode:0o600});await chmod(tokenPath,0o600);
    const tokenHash=createHash('sha256').update(token).digest('hex');
    const temporary=`${statePath}.${launchNonce}.tmp`;await writeFile(temporary,JSON.stringify({protocol:1,port:activePort,pid:process.pid,tokenHash})+'\n',{mode:0o600,flag:'wx'});await rename(temporary,statePath);
    process.stdout.write(`REV_DAEMON_READY ${activePort}\n`);
    startCaptureLoop();
    process.once('SIGTERM',()=>void shutdown());process.once('SIGINT',()=>void shutdown());
  } catch(error){
    stopCaptureLoop();
    if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
    if(databaseOpened)await closeDatabase();if(lockOwned){await Promise.all([rm(statePath,{force:true}),rm(tokenPath,{force:true})]);try {await releaseLock();} catch { /* leave uncertain ownership for inspection */ }}throw error;
  }
}
void main().catch(error=>{process.stderr.write(`ReV daemon failed: ${error instanceof Error?error.message:'unknown error'}\n`);process.exitCode=1;});
