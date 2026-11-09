import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { chmod, mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { readJsonLimited } from '@/lib/server/body';
import { newRun, updateAction, readRun, readGraph, exportMarkdown, refreshRun, deleteRun, listRuns, clientError } from '@/lib/server/service';
import { closeDatabase, database } from '@/lib/server/store';
import { listProjects, registerProject, removeProject, setProjectPaused } from '@/lib/server/projects';

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

async function acquireLock():Promise<void> {
  try { await mkdir(lockPath,{mode:0o700});lockOwned=true; }
  catch(error) {
    if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error('A ReV daemon is already using this data directory, or a stale daemon lock requires inspection');
    throw error;
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
      if(req.method==='GET'){json(res,200,{projects:await listProjects()});return;}
      if(req.method==='POST'){json(res,201,{project:await registerProject(await body(req,32_000))});return;}
    }
    const projectMatch=/^\/v1\/projects\/([0-9a-fA-F-]+)$/.exec(url.pathname);
    if(projectMatch){
      const id=uuid(projectMatch[1]);
      if(req.method==='PATCH'){const args=z.object({paused:z.boolean()}).strict().parse(await body(req,4_000));json(res,200,{project:await setProjectPaused(id,args.paused)});return;}
      if(req.method==='DELETE'){await removeProject(id);json(res,200,{ok:true});return;}
      json(res,405,{error:'Method not allowed'});return;
    }
    if(url.pathname==='/v1/runs'){
      if(req.method==='GET'){json(res,200,{runs:await listRuns()});return;}
      if(req.method==='POST'){json(res,201,{run:await newRun(await body(req,15_000_000))});return;}
    }
    const match=/^\/v1\/runs\/([0-9a-fA-F-]+)(?:\/(graph|export|refresh))?$/.exec(url.pathname);
    if(!match){json(res,404,{error:'Not found'});return;}
    const id=uuid(match[1]);const action=match[2];
    if(!action&&req.method==='GET'){json(res,200,{run:await readRun(id)});return;}
    if(!action&&req.method==='PATCH'){json(res,200,{run:await updateAction(id,await body(req,1_000_000))});return;}
    if(!action&&req.method==='DELETE'){await readRun(id);await deleteRun(id);json(res,200,{ok:true});return;}
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

async function shutdown():Promise<void> {
  if(closing)return;closing=true;
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
    process.once('SIGTERM',()=>void shutdown());process.once('SIGINT',()=>void shutdown());
  } catch(error){
    if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
    if(databaseOpened)await closeDatabase();if(lockOwned){await Promise.all([rm(statePath,{force:true}),rm(tokenPath,{force:true})]);try {await releaseLock();} catch { /* leave uncertain ownership for inspection */ }}throw error;
  }
}
void main().catch(error=>{process.stderr.write(`ReV daemon failed: ${error instanceof Error?error.message:'unknown error'}\n`);process.exitCode=1;});
