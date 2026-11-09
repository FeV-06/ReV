import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpath,stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { githubUsernameSchema } from '@/lib/contracts';
import { database } from '@/lib/server/store';

const execFileAsync=promisify(execFile);
const registerSchema=z.object({root:z.string().min(1).max(4096),githubUsername:githubUsernameSchema,confirmWatch:z.literal(true)});
type ProjectRow={id:string;root:string;root_key:string;github_username:string;git_common_dir:string;git_dir:string|null;created_at:string|Date;paused:boolean};
export type Project={id:string;root:string;githubUsername:string;gitCommonDir:string;gitDir:string|null;createdAt:string;paused:boolean;captureStatus:'not_implemented'};
function project(row:ProjectRow):Project{return {id:row.id,root:row.root,githubUsername:row.github_username,gitCommonDir:row.git_common_dir,gitDir:row.git_dir,createdAt:new Date(row.created_at).toISOString(),paused:row.paused,captureStatus:'not_implemented'};}
function key(root:string):string {const normalized=path.normalize(root);return process.platform==='win32'?normalized.toLowerCase():normalized;}
function contains(parent:string,child:string):boolean {const rel=path.relative(parent,child);return rel===''||(!rel.startsWith(`..${path.sep}`)&&rel!=='..'&&!path.isAbsolute(rel));}
export async function inspectRoot(input:string):Promise<{root:string;common:string;gitDir:string}> {
 if(!path.isAbsolute(input))throw new Error('Project root must be an absolute path');
 const root=await realpath(input);if(!(await stat(root)).isDirectory())throw new Error('Project root must be a directory');
 let output:string;
 try {
  ({stdout:output}=await execFileAsync('git',['-C',root,'rev-parse','--show-toplevel','--git-common-dir','--absolute-git-dir'],{timeout:10_000,maxBuffer:32_768,windowsHide:true,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0'}}));
 } catch {throw new Error('Project root is not an accessible Git worktree');}
 const [reportedRoot,commonDir,gitDir]=output.trim().split(/\r?\n/);if(!reportedRoot||!commonDir||!gitDir)throw new Error('Could not identify Git root');
 const realRoot=await realpath(reportedRoot);if(key(root)!==key(realRoot))throw new Error('Select the Git worktree root, not a nested directory');
 const common=await realpath(path.resolve(root,commonDir));return {root:realRoot,common,gitDir:await realpath(gitDir)};
}
export async function registerProject(raw:unknown):Promise<Project>{
 const args=registerSchema.parse(raw);const inspected=await inspectRoot(args.root);const db=await database();const rootKey=key(inspected.root);
 return db.transaction(async tx=>{
  await tx.query('LOCK TABLE projects IN EXCLUSIVE MODE');
  const existing=await tx.query<ProjectRow>('SELECT * FROM projects');
  if(existing.rows.some(r=>contains(r.root_key,rootKey)||contains(rootKey,r.root_key)))throw new Error('Project root is already registered or overlaps an existing project');
  const id=randomUUID();const createdAt=new Date().toISOString();
  const result=await tx.query<ProjectRow>('INSERT INTO projects (id,root,root_key,github_username,git_common_dir,git_dir,created_at,paused) VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING *',[id,inspected.root,rootKey,args.githubUsername,inspected.common,inspected.gitDir,createdAt]);
  return project(result.rows[0]);
 });
}
export async function listProjects():Promise<Project[]> {
 const rows=await (await database()).query<ProjectRow>('SELECT * FROM projects ORDER BY created_at,id');return rows.rows.map(project);
}
export async function getProject(id:string):Promise<Project>{
 z.string().uuid().parse(id);const result=await (await database()).query<ProjectRow>('SELECT * FROM projects WHERE id=$1',[id]);if(!result.rows.length)throw new Error('Project not found');return project(result.rows[0]);
}
export async function setProjectPaused(id:string,paused:boolean):Promise<Project>{
 z.string().uuid().parse(id);z.boolean().parse(paused);if(!paused)throw new Error('Project capture is not implemented; cannot resume');const result=await (await database()).query<ProjectRow>('UPDATE projects SET paused=$2 WHERE id=$1 RETURNING *',[id,paused]);
 if(!result.rows.length)throw new Error('Project not found');return project(result.rows[0]);
}
export async function removeProject(id:string):Promise<void>{
 z.string().uuid().parse(id);const result=await (await database()).query('DELETE FROM projects WHERE id=$1 RETURNING id',[id]);if(!result.rows.length)throw new Error('Project not found');
}
