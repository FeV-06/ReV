import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {database} from '@/lib/server/store';
import {getProject,inspectRoot} from '@/lib/server/projects';

const exec=promisify(execFile);
const excludedNames=new Set(['.env','node_modules','target','dist','build','.next','.git','.rev-data','credentials','secrets','secret','private','id_rsa','id_ed25519']);
export type WorkingChange={path:string;indexStatus:string;worktreeStatus:string};
export type ProjectSnapshot={id:string;projectId:string;observedAt:string;baseline:boolean;commitId:string|null;branch:string|null;changes:WorkingChange[];excludedCount:number;coverage:'working_tree_metadata_only'};
function safePath(value:string):boolean {
 const segments=value.replaceAll('\\','/').split('/');
 return !path.isAbsolute(value)&&segments.every(s=>s!==''&&s!=='.'&&s!=='..'&&!excludedNames.has(s.toLowerCase())&&!s.toLowerCase().startsWith('.env.')&&!/\.(pem|key|p12|pfx|kdbx)$/i.test(s));
}
function parseStatus(output:string):{changes:WorkingChange[];excludedCount:number}{
 const changes:WorkingChange[]=[];let excludedCount=0;
 for(const entry of output.split('\0')){
  if(!entry)continue;if(entry.length<4||entry[2]!==' ')throw new Error('Unexpected Git status format');
  const filename=entry.slice(3);if(!safePath(filename)){excludedCount++;continue;}
  changes.push({path:filename,indexStatus:entry[0],worktreeStatus:entry[1]});
 }
 changes.sort((a,b)=>a.path.localeCompare(b.path)||a.indexStatus.localeCompare(b.indexStatus)||a.worktreeStatus.localeCompare(b.worktreeStatus));
 return {changes,excludedCount};
}
async function scratchGitDir(common:string):Promise<string>{
 const base=path.resolve(process.env.REV_DATA_DIR || path.join(os.tmpdir(),'rev-capture'));await mkdir(base,{recursive:true,mode:0o700});
 const dir=await mkdtemp(path.join(base,'scan-'));try {
  await mkdir(path.join(dir,'objects','info'),{recursive:true});await mkdir(path.join(dir,'refs','heads'),{recursive:true});
  await writeFile(path.join(dir,'objects','info','alternates'),path.join(common,'objects')+'\n',{mode:0o600});
  await writeFile(path.join(dir,'config'),'[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfsmonitor = false\n[status]\n\tshowUntrackedFiles = all\n',{mode:0o600});
  await writeFile(path.join(dir,'HEAD'),'ref: refs/heads/rev-empty\n',{mode:0o600});
  try{await writeFile(path.join(dir,'index'),await readFile(path.join(common,'index')),{mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return dir;
 }catch(error){await rm(dir,{recursive:true,force:true});throw error;}
}
async function cleanGit(root:string,gitDir:string,args:string[]):Promise<string>{
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_CONFIG_SYSTEM:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1'};
 for(const name of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_CONFIG_COUNT','GIT_EXTERNAL_DIFF','GIT_EXEC_PATH','GIT_CONFIG_PARAMETERS'])delete (env as Record<string,string|undefined>)[name];
 try{return (await exec('git',['--git-dir',gitDir,'--work-tree',root,'-c','core.fsmonitor=false','--no-optional-locks',...args],{env,timeout:20_000,maxBuffer:4_000_000,windowsHide:true,encoding:'utf8'})).stdout;}
 catch{throw new Error('Git snapshot failed or exceeded resource limits');}
}
export async function readLatestSnapshot(projectId:string):Promise<ProjectSnapshot|null>{
 const result=await (await database()).query<{payload:ProjectSnapshot}>('SELECT payload FROM project_snapshots WHERE project_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 1',[projectId]);return result.rows[0]?.payload||null;
}
export async function listProjectSnapshots(projectId:string,limit=10):Promise<ProjectSnapshot[]>{
 const result=await (await database()).query<{payload:ProjectSnapshot}>('SELECT payload FROM project_snapshots WHERE project_id=$1 ORDER BY observed_at DESC,id DESC LIMIT $2',[projectId,limit]);
 return result.rows.map(r=>r.payload);
}
export async function scanProject(projectId:string):Promise<ProjectSnapshot>{
 const project=await getProject(projectId);const root=await inspectRoot(project.root);
 if(root.root!==project.root||root.common!==project.gitCommonDir)throw new Error('Project root or Git directory changed; re-registration required');
 // Resolve ref metadata without reading source contents; status runs with a scratch Git
 // configuration and copied index, so repository-defined clean filters cannot execute.
 let head:string|null=null;let branch:string|null=null;
 const headFile=path.join(project.root,'.git','HEAD');
 try {const value=(await readFile(headFile,'utf8')).trim();if(value.startsWith('ref: refs/heads/'))branch=value.slice('ref: refs/heads/'.length);else if(/^[a-f0-9]{40,64}$/i.test(value))head=value;} catch{}
 const scratch=await scratchGitDir(root.common);
 try {
  if(branch){try {head=(await readFile(path.join(root.common,'refs','heads',...branch.split('/')),'utf8')).trim();}catch{head=null;}}
  if(head&&!/^[a-f0-9]{40,64}$/i.test(head))head=null;
  if(head)await writeFile(path.join(scratch,'HEAD'),head+'\n',{mode:0o600});
  const status=await cleanGit(project.root,scratch,['status','--porcelain=v1','-z','--untracked-files=all','--no-renames','--ignore-submodules=all']);
  const parsed=parseStatus(status);const payload={commitId:head,branch,...parsed};
  const fingerprint=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const db=await database();return await db.transaction(async tx=>{
   const row=await tx.query<{id:string}>('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[projectId]);if(!row.rows.length)throw new Error('Project not found');
   const last=await tx.query<{payload:ProjectSnapshot;fingerprint:string}>('SELECT payload,fingerprint FROM project_snapshots WHERE project_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 1',[projectId]);
   if(last.rows[0]?.fingerprint===fingerprint)return last.rows[0].payload;
   const snapshot:ProjectSnapshot={id:randomUUID(),projectId,observedAt:new Date().toISOString(),baseline:!last.rows.length,...payload,coverage:'working_tree_metadata_only'};
   await tx.query('INSERT INTO project_snapshots (id,project_id,observed_at,fingerprint,payload) VALUES ($1,$2,$3,$4,$5::jsonb)',[snapshot.id,projectId,snapshot.observedAt,fingerprint,JSON.stringify(snapshot)]);return snapshot;
  });
 }finally{await rm(scratch,{recursive:true,force:true});}
}
