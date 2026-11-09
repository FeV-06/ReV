import {afterAll,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,stat,symlink,utimes,writeFile} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {closeDatabase} from '@/lib/server/store';
import {registerProject,removeProject} from '@/lib/server/projects';
import {scanProject,readLatestSnapshot} from '@/lib/server/capture';

process.env.REV_DATA_DIR=path.join(tmpdir(),`rev-capture-${process.pid}`);
function git(root:string,...args:string[]){return execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();}
async function setup(){
 const root=await mkdtemp(path.join(tmpdir(),'rev-capture-repo-'));git(root,'init','-q');git(root,'config','user.name','Other');git(root,'config','user.email','other@example.invalid');
 await writeFile(path.join(root,'app.txt'),'original\n');git(root,'add','app.txt');git(root,'commit','-qm','first');
 await writeFile(path.join(root,'.gitignore'),'ignored.txt\n');git(root,'add','.gitignore');git(root,'commit','-qm','ignore');
 return root;
}
afterAll(async()=>{await closeDatabase();});
describe('incremental Git metadata capture',()=>{
 it('records snapshots of commits and safe saved/uncommitted path metadata without source contents',async()=>{
  const root=await setup();let id='';try{
   const p=await registerProject({root,githubUsername:'FeV-06',confirmWatch:true});id=p.id;
   let snap=await scanProject(id);expect(snap.baseline).toBe(true);expect(snap.commitId).toBe(git(root,'rev-parse','HEAD'));expect(snap.changes).toEqual([]);
   const marker='DO_NOT_CAPTURE_SECRET_CONTENT_123';await writeFile(path.join(root,'app.txt'),marker);await writeFile(path.join(root,'new.txt'),'new');await writeFile(path.join(root,'ignored.txt'),'ignored');
   await mkdir(path.join(root,'build'));await writeFile(path.join(root,'build','output.txt'),'generated');await writeFile(path.join(root,'.env'),'secret');
   const next=await scanProject(id);expect(next.baseline).toBe(false);expect(next.changes.map(x=>x.path)).toContain('app.txt');expect(next.changes.map(x=>x.path)).toContain('new.txt');
   expect(next.changes.map(x=>x.path)).not.toContain('ignored.txt');expect(next.changes.map(x=>x.path)).not.toContain('.env');expect(next.changes.map(x=>x.path)).not.toContain('build/output.txt');
   expect(JSON.stringify(next)).not.toContain(marker);expect((await readLatestSnapshot(id))?.id).toBe(next.id);
   await writeFile(path.join(root,'app.txt'),'committed\n');git(root,'add','app.txt');git(root,'commit','-qm','second');
   const committed=await scanProject(id);expect(committed.commitId).toBe(git(root,'rev-parse','HEAD'));expect(committed.commitId).not.toBe(snap.commitId);
  }finally{if(id)await removeProject(id);await rm(root,{recursive:true,force:true});}
 });
 it('rejects symlink substitution and missing project roots',async()=>{
  const root=await setup();let id='';try {const p=await registerProject({root,githubUsername:'FeV-06',confirmWatch:true});id=p.id;
   const moved=root+'-moved';await import('node:fs/promises').then(fs=>fs.rename(root,moved));await symlink(moved,root,'dir');
   await expect(scanProject(id)).rejects.toThrow();await rm(root,{force:true});await rm(moved,{recursive:true,force:true});
  }finally{if(id)await removeProject(id);await rm(root,{recursive:true,force:true});}
 });
 it('never runs repository-configured clean filters while scanning',async()=>{
  const root=await setup();let id='';try{
   await writeFile(path.join(root,'.gitattributes'),'app.txt filter=rev-test\n');git(root,'add','.gitattributes');git(root,'commit','-qm','attributes');
   const before=await stat(path.join(root,'app.txt'));await writeFile(path.join(root,'app.txt'),'modified\n');await utimes(path.join(root,'app.txt'),before.atime,before.mtime);
   const marker=path.join(root,'filter-executed');git(root,'config','filter.rev-test.clean',`touch ${marker}; cat`);
   const p=await registerProject({root,githubUsername:'FeV-06',confirmWatch:true});id=p.id;await scanProject(id);
   await expect(stat(marker)).rejects.toMatchObject({code:'ENOENT'});
   git(root,'status','--porcelain');expect((await stat(marker)).isFile()).toBe(true);
  }finally{if(id)await removeProject(id);await rm(root,{recursive:true,force:true});}
 });
});
