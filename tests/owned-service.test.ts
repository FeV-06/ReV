import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { newRun, readRun, readGraph, refreshRun, updateAction } from '@/lib/server/service';
import { closeDatabase, compareAndUpdate, deleteRun, getVersionedRun, listRunsForAuthority } from '@/lib/server/store';
import { changeRunVisibility } from '@/lib/server/run-permissions';
import { readPermission } from '@/lib/server/run-permissions';
import type { RunAuthority } from '@/lib/server/store';

const teamId=randomUUID();
const owner:RunAuthority={userId:randomUUID(),teamId,role:'member'};
const lead:RunAuthority={userId:randomUUID(),teamId,role:'leader'};
const other:RunAuthority={userId:randomUUID(),teamId,role:'member'};
const outside:RunAuthority={userId:randomUUID(),teamId:randomUUID(),role:'leader'};
let dataDir='';
beforeAll(async()=>{ dataDir=await mkdtemp(path.join(tmpdir(),'rev-owned-service-')); process.env.REV_DATA_DIR=dataDir; });
afterAll(async()=>{await closeDatabase(); if(dataDir)await rm(dataDir,{recursive:true,force:true});});

describe('owned service lifecycle',()=>{
  it('creates a private run atomically, filters lists and denies other users',async()=>{
    const run=await newRun({recipient:'Private service fixture',fixture:true},owner);
    expect((await listRunsForAuthority(owner)).map(x=>x.id)).toContain(run.id);
    for(const actor of [lead,other,outside]){
      expect((await listRunsForAuthority(actor)).map(x=>x.id)).not.toContain(run.id);
      await expect(readRun(run.id,actor)).rejects.toThrow('access denied');
      await expect(readGraph(run.id,actor)).rejects.toThrow('access denied');
      await expect(updateAction(run.id,{action:'scope',selectedIds:[]},actor)).rejects.toThrow('access denied');
      await expect(deleteRun(run.id,actor)).rejects.toThrow('access denied');
    }
    expect((await readRun(run.id,owner)).id).toBe(run.id);
  });

  it('enforces share revocation again at the write boundary',async()=>{
    const run=await newRun({recipient:'Review fixture',fixture:true},owner);
    const principal={id:owner.userId,teamId};
    const verify=async()=> 'member' as const;
    await changeRunVisibility(run.id,principal,'lead',0,verify);
    expect((await readRun(run.id,lead)).id).toBe(run.id);
    const stored=await getVersionedRun(run.id); expect(stored).not.toBeNull();
    await changeRunVisibility(run.id,principal,'private',1,verify);
    await expect(compareAndUpdate({...stored!.run,recipient:'stale unauthorized change'},stored!.version,lead)).rejects.toThrow('changed');
    expect((await readRun(run.id,owner)).recipient).toBe('Review fixture');
    await expect(readRun(run.id,lead)).rejects.toThrow('access denied');
    await deleteRun(run.id,owner);
  });

  it('does not assign legacy local runs to newly signed-in identities',async()=>{
    const legacy=await newRun({recipient:'Existing local',fixture:true});
    expect((await listRunsForAuthority(owner)).map(x=>x.id)).not.toContain(legacy.id);
    await expect(readRun(legacy.id,owner)).rejects.toThrow('access denied');
    expect((await readRun(legacy.id)).recipient).toBe('Existing local');
  });

  it('keeps the original owner and sharing state when the lead refreshes a shared handover',async()=>{
    const run=await newRun({recipient:'Refresh ownership',fixture:true},owner);
    await changeRunVisibility(run.id,{id:owner.userId,teamId},'lead',0,async()=> 'member');
    const next=await refreshRun(run.id,{sources:run.artifacts,revokedIds:[],expectedRevision:run.revision},lead);
    expect(await readPermission(next.id)).toMatchObject({ownerId:owner.userId,teamId,visibility:'lead'});
    await expect(readRun(next.id,other)).rejects.toThrow('access denied');
  });
});
