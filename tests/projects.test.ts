import { describe,it,expect } from 'vitest';
import { mkdtemp,mkdir,rm,writeFile } from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {database,closeDatabase} from '@/lib/server/store';
import {registerProject,listProjects,setProjectPaused,removeProject} from '@/lib/server/projects';
import {randomUUID} from 'node:crypto';

process.env.REV_DATA_DIR=path.join(tmpdir(),`rev-projects-${process.pid}`);

describe('project registry',()=>{
 it('registers an explicitly approved Git root, rejects aliases/nesting, and persists pause state',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'rev-project-root-'));const nested=path.join(root,'nested');await mkdir(nested);
  execFileSync('git',['init','-q',root]);
  try {
   const project=await registerProject({root,githubUsername:'FeV-06',confirmWatch:true});
   expect(project.root).toBe(root);expect(project.githubUsername).toBe('FeV-06');expect(project.paused).toBe(true);expect(project.captureStatus).toBe('not_implemented');
   await expect(registerProject({root,githubUsername:'FeV-06',confirmWatch:true})).rejects.toThrow('already');
   await expect(registerProject({root:nested,githubUsername:'FeV-06',confirmWatch:true})).rejects.toThrow('root');
   await expect(registerProject({root,githubUsername:'FeV-06',confirmWatch:false})).rejects.toThrow();
   const unpaused=await setProjectPaused(project.id,false);expect(unpaused.paused).toBe(false);expect(unpaused.captureStatus).toBe('active');
   await setProjectPaused(project.id,true);expect((await listProjects()).find(p=>p.id===project.id)?.paused).toBe(true);
   await closeDatabase();expect((await listProjects()).find(p=>p.id===project.id)?.paused).toBe(true);
   await removeProject(project.id);expect((await listProjects()).some(p=>p.id===project.id)).toBe(false);
  } finally {await rm(root,{recursive:true,force:true});}
 });
 it('fails closed on missing project and paths that are not Git repositories',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'rev-not-git-'));
  try {await expect(registerProject({root,githubUsername:'FeV-06',confirmWatch:true})).rejects.toThrow('Git');await expect(setProjectPaused(randomUUID(),true)).rejects.toThrow('not found');}
  finally{await rm(root,{recursive:true,force:true});}
 });
});
