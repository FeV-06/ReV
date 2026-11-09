import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {afterAll,describe,expect,it} from 'vitest';
import {closeDatabase} from '@/lib/server/store';
import {registerProject,removeProject} from '@/lib/server/projects';
process.env.REV_DATA_DIR=path.join(tmpdir(),`rev-real-project-${process.pid}`);
const clone=process.env.REV_TEST_GIT_ROOT;
describe.skipIf(!clone)('real repository registration',()=>{
 it('registers the requested Blinky checkout without mutating it',async()=>{
  const root=clone!;const before=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const p=await registerProject({root,githubUsername:'FeV-06',confirmWatch:true});expect(p.githubUsername).toBe('FeV-06');expect(p.captureStatus).toBe('not_implemented');
  await removeProject(p.id);const after=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();expect(after).toBe(before);
 });
});
afterAll(async()=>{await closeDatabase();});
