import { describe,it,expect } from 'vitest';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync,spawnSync } from 'node:child_process';

describe('git ownership analysis on a real local repository',()=>{
 it('computes blame ownership, churn, aliases and explicit missing coverage',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'rev-risk-'));
  try {
   const git=(args:string[],author='alice@example.invalid')=>execFileSync('git',['-C',dir,...args],{env:{...process.env,GIT_AUTHOR_NAME:author,GIT_AUTHOR_EMAIL:author,GIT_COMMITTER_NAME:author,GIT_COMMITTER_EMAIL:author},stdio:'pipe'});
   git(['init','-b','main']);
   await writeFile(path.join(dir,'shared.txt'),'alice line\nbob line\n');git(['add','shared.txt']);git(['commit','-m','initial']);
   await writeFile(path.join(dir,'shared.txt'),'alice line\nbob changed\n');git(['add','shared.txt'],'bob@example.invalid');git(['commit','-m','bob change'],'bob@example.invalid');
   await writeFile(path.join(dir,'alice.txt'),'one\ntwo\n');git(['add','alice.txt']);git(['commit','-m','alice owns module']);
   await writeFile(path.join(dir,'staged-not-committed.txt'),'ignore this index change');git(['add','staged-not-committed.txt']);
   const res=spawnSync(path.resolve('target/debug/rev-core'),[],{input:JSON.stringify({op:'analyze_local_risk',path:dir,emails:['alice@example.invalid'],maxFiles:100}),encoding:'utf8'});
   const out=JSON.parse(res.stdout);expect(out.ok).toBe(true);const modules=out.data.modules;
   const solo=modules.find((m:{path:string})=>m.path==='alice.txt');const shared=modules.find((m:{path:string})=>m.path==='shared.txt');
   expect(out.data.revision).toMatch(/^[0-9a-f]{40,64}$/);expect(out.data.warnings).toEqual([]);expect(modules.some((m:{path:string})=>m.path==='staged-not-committed.txt')).toBe(false);expect(solo.ownershipFraction).toBe(1);expect(shared.ownershipFraction).toBe(0.5);expect(solo.testCoverage).toBeNull();expect(shared.churnLines).toBeGreaterThan(0);expect(solo.explanation).toContain('not supplied');
  } finally {await rm(dir,{recursive:true,force:true});}
 });
});
