import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { requestDaemon } from '@/lib/server/daemon-client';

const root=process.cwd();
let dataDir='';
let daemon:ChildProcess|undefined;
let address='';
let token='';

async function start() {
  daemon=spawn(process.execPath,[path.join(root,'dist/daemon/entry.js')],{cwd:root,env:{...process.env,REV_DATA_DIR:dataDir,REV_DAEMON_PORT:'0'},stdio:['ignore','pipe','pipe']});
  let output='';
  await new Promise<void>((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error(`Daemon did not become ready: ${output}`)),15_000);
    daemon!.stdout!.on('data',(chunk:Buffer)=>{output+=chunk.toString();const match=output.match(/REV_DAEMON_READY (\d+)/);if(match){clearTimeout(timeout);address=`http://127.0.0.1:${match[1]}`;resolve();}});
    daemon!.stderr!.on('data',(chunk:Buffer)=>{output+=chunk.toString();});
    daemon!.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Daemon exited ${code}: ${output}`));});
  });
  token=(await readFile(path.join(dataDir,'daemon.token'),'utf8')).trim();
}
async function stop() {
  if(!daemon||daemon.exitCode!==null)return;
  const child=daemon;const tokenPath=path.join(dataDir,'daemon.token');const controlToken=(await readFile(tokenPath,'utf8')).trim();await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Daemon did not exit')),10_000);child.once('exit',()=>{clearTimeout(timer);resolve();});void fetch(`${address}/v1/shutdown`,{method:'POST',headers:{authorization:`Bearer ${controlToken}`}}).catch(reject);});daemon=undefined;
}
async function request(route:string,method='GET',body?:object,extra:Record<string,string>={}) {
  return fetch(`${address}${route}`,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)});
}

beforeAll(async()=>{dataDir=await mkdtemp(path.join(tmpdir(),'rev-daemon-test-'));await start();},30_000);
afterAll(async()=>{await stop();if(dataDir)await rm(dataDir,{recursive:true,force:true});},20_000);

describe('daemon API over a real child process',()=>{
 it('requires authentication and rejects browser-origin and hostile host requests',async()=>{
  expect((await fetch(`${address}/v1/health`)).status).toBe(401);
  expect((await request('/v1/health','GET',undefined,{authorization:`Bearer ${randomBytes(32).toString('hex')}`})).status).toBe(401);
  expect((await request('/v1/health','GET',undefined,{origin:'https://evil.example'})).status).toBe(403);
  const hostileHost=await new Promise<number|undefined>((resolve,reject)=>{const r=http.get(`${address}/v1/health`,{headers:{host:'evil.example',authorization:`Bearer ${token}`}},response=>{response.resume();resolve(response.statusCode);});r.on('error',reject);});expect(hostileHost).toBe(403);
  const health=await request('/v1/health');expect(health.status).toBe(200);expect((await health.json()).protocol).toBe(1);
  if(process.platform!=='win32')expect((await stat(path.join(dataDir,'daemon.token'))).mode&0o077).toBe(0);
 });
 it('fails closed when daemon metadata and token do not match',async()=>{
  const old=process.env.REV_DATA_DIR;process.env.REV_DATA_DIR=dataDir;const metadataPath=path.join(dataDir,'daemon.json');const original=await readFile(metadataPath,'utf8');
  try {const metadata=JSON.parse(original);metadata.tokenHash='0'.repeat(64);await writeFile(metadataPath,JSON.stringify(metadata));await expect(requestDaemon('/v1/health')).rejects.toThrow('unavailable');}
  finally {await writeFile(metadataPath,original);if(old===undefined)delete process.env.REV_DATA_DIR;else process.env.REV_DATA_DIR=old;}
 });
 it('registers an approved Git project, persists pause state, and never claims capture is running',async()=>{
  const projectRoot=await mkdtemp(path.join(tmpdir(),'rev-daemon-project-'));
  const {execFileSync}=await import('node:child_process');execFileSync('git',['init','-q',projectRoot]);
  try {
   let response=await request('/v1/projects','POST',{root:projectRoot,githubUsername:'FeV-06',confirmWatch:true});expect(response.status).toBe(201);const project=(await response.json()).project;expect(project.captureStatus).toBe('not_implemented');
   response=await request(`/v1/projects/${project.id}`,'PATCH',{paused:true});expect((await response.json()).project.paused).toBe(true);
   await stop();await start();response=await request('/v1/projects');const projects=(await response.json()).projects;expect(projects.find((p:{id:string})=>p.id===project.id).paused).toBe(true);
   expect((await request(`/v1/projects/${project.id}`,'DELETE')).status).toBe(200);
  } finally {await rm(projectRoot,{recursive:true,force:true});}
 });
 it('supports on-demand project scanning and snapshot history via daemon endpoints',async()=>{
  const projectRoot=await mkdtemp(path.join(tmpdir(),'rev-daemon-scan-'));
  const {execFileSync}=await import('node:child_process');execFileSync('git',['init','-q',projectRoot]);
  const appFile=path.join(projectRoot,'index.ts');await writeFile(appFile,'console.log("hello");\n');
  execFileSync('git',['-C',projectRoot,'add','.']);
  execFileSync('git',['-C',projectRoot,'-c','user.name=FeV','-c','user.email=fev@example.invalid','commit','-qm','initial']);
  try {
   const registerResp=await request('/v1/projects','POST',{root:projectRoot,githubUsername:'FeV-06',confirmWatch:true});
   expect(registerResp.status).toBe(201);
   const project=(await registerResp.json()).project;
   const scanResp=await request(`/v1/projects/${project.id}/scan`,'POST');
   expect(scanResp.status).toBe(200);
   const snapshot=(await scanResp.json()).snapshot;
   expect(snapshot.baseline).toBe(true);
   expect(snapshot.commitId).toBeDefined();
   const snapshotsResp=await request(`/v1/projects/${project.id}/snapshots`);
   expect(snapshotsResp.status).toBe(200);
   const snapshots=(await snapshotsResp.json()).snapshots;
   expect(snapshots.length).toBe(1);
   expect(snapshots[0].id).toBe(snapshot.id);
   const unpauseResp=await request(`/v1/projects/${project.id}`,'PATCH',{paused:false});
   expect(unpauseResp.status).toBe(200);
   expect((await unpauseResp.json()).project.paused).toBe(false);
   await request(`/v1/projects/${project.id}`,'DELETE');
  } finally {await rm(projectRoot,{recursive:true,force:true});}
 });
 it('supports reviewed fixture workflow, invalidation, restart persistence and isolated second instance',async()=>{
  const create=await request('/v1/runs','POST',{recipient:'Engineer',githubUsername:'FeV-06',targetRole:'Backend engineer',fixture:true});expect(create.status).toBe(201);let run=(await create.json()).run;
  expect(run.githubUsername).toBe('FeV-06');const selectedIds=[run.artifacts[0].id];
  let response=await request(`/v1/runs/${run.id}`,'PATCH',{action:'scope',selectedIds});expect(response.status).toBe(200);
  response=await request(`/v1/runs/${run.id}`,'PATCH',{action:'generate',selectedIds,acceptPartial:false,confirmAuthorisation:true,fixture:true});run=(await response.json()).run;expect(run.items.length).toBeGreaterThan(0);
  response=await request(`/v1/runs/${run.id}`,'PATCH',{action:'approve',confirmAuthorisation:true});expect(response.status).toBe(200);
  expect((await request(`/v1/runs/${run.id}/export`)).status).toBe(200);
  const second=spawn(process.execPath,[path.join(root,'dist/daemon/entry.js')],{cwd:root,env:{...process.env,REV_DATA_DIR:dataDir,REV_DAEMON_PORT:'0'},stdio:['ignore','pipe','pipe']});
  let stderr='';second.stderr!.on('data',(c:Buffer)=>stderr+=c.toString());
  const exit=await new Promise<number|null>(resolve=>second.once('exit',resolve));expect(exit).not.toBe(0);expect(stderr).toContain('already');
  expect((await request('/v1/health')).status).toBe(200);
  await stop();await start();response=await request(`/v1/runs/${run.id}`);expect((await response.json()).run.state).toBe('approved');
  response=await request(`/v1/runs/${run.id}`,'PATCH',{action:'scope',selectedIds:[]});expect(response.status).toBe(200);
  expect((await request(`/v1/runs/${run.id}/export`)).status).toBe(400);
  expect((await request(`/v1/runs/${run.id}`,'DELETE')).status).toBe(200);
  expect((await request(`/v1/runs/${randomUUID()}`)).status).toBe(400);
 });
 it.skipIf(process.env.REV_TEST_GITHUB_LIVE!=='1')('imports KingSahil/Blinky and matches FeV-06 through the daemon',async()=>{
  const response=await request('/v1/runs','POST',{recipient:'Review test',githubUsername:'FeV-06',targetRole:'Engineer',repo:'KingSahil/Blinky'});
  expect(response.status).toBe(201);const run=(await response.json()).run;
  expect(run.state).toBe('awaiting_scope_confirmation');
  const matching=run.artifacts.filter((a:{kind:string;githubLogin?:string})=>a.kind==='github_commit'&&a.githubLogin?.toLowerCase()==='fev-06');
  expect(matching.length).toBeGreaterThan(0);expect(run.selectedIds).toEqual([]);
  console.log(`Live GitHub import: ${run.artifacts.length} records, ${matching.length} contributor-linked commits, ${run.warnings.length} warnings; no generation request sent`);
  await request(`/v1/runs/${run.id}`,'DELETE');
 },150_000);
});
