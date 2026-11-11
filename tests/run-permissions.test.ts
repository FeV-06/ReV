import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeDatabase, createRun, getRun } from '@/lib/server/store';
import { assertRunAccess, changeRunVisibility, readPermission, type Principal } from '@/lib/server/run-permissions';
import { authorizeOwnedRun, createOwnedRun, listOwnedRunIds } from '@/lib/server/owned-runs';
import { SessionRegistry } from '@/lib/server/auth-sessions';
import type { Run } from '@/lib/contracts';

const team = randomUUID(), otherTeam = randomUUID();
const owner: Principal = { id: randomUUID(), teamId: team };
const member: Principal = { id: randomUUID(), teamId: team };
const lead: Principal = { id: randomUUID(), teamId: team };
const outsider: Principal = { id: randomUUID(), teamId: otherTeam };
let revoked = new Set<string>();
const verify = async (p: Principal) => p.teamId !== team || revoked.has(p.id) ? null : p.id === lead.id ? 'leader' as const : 'member' as const;
let directory = '';

function runFixture(): Run {
  const run: Run = { id:randomUUID(), recipient:'Fixture', createdAt:new Date().toISOString(), state:'needs_review', artifacts:[], warnings:[], selectedIds:[], items:[], mode:'fixture', revision:0, approvedRevision:null, acceptedPartial:false };
  return run;
}

beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(),'rev-authz-')); process.env.REV_DATA_DIR=directory; });
afterAll(async () => { await closeDatabase(); if (directory) await rm(directory,{recursive:true,force:true}); });

describe('server-side handover access', () => {
  it('binds authorization to verified sessions rather than caller-provided roles or user IDs', async () => {
    const registry = new SessionRegistry({ verify: async token => ({ id: token === 'owner-token' ? owner.id : member.id }) });
    const alice = await registry.establish('owner-token', Date.now() + 60_000);
    const bob = await registry.establish('member-token', Date.now() + 60_000);
    const run: Run = { id:randomUUID(), recipient:'Session fixture', createdAt:new Date().toISOString(), state:'needs_review', artifacts:[], warnings:[], selectedIds:[], items:[], mode:'fixture', revision:0, approvedRevision:null, acceptedPartial:false };
    await createOwnedRun(run,owner,verify);
    const deps = { requireSession: (credential: string | undefined) => registry.require(credential), teamId:team, verifyMembership:verify };
    await expect(authorizeOwnedRun(alice.credential,run.id,'read',deps)).resolves.toEqual(owner);
    await expect(authorizeOwnedRun(bob.credential,run.id,'read',deps)).rejects.toThrow('access denied');
    registry.revoke(alice.credential);
    await expect(authorizeOwnedRun(alice.credential,run.id,'read',deps)).rejects.toThrow('Authentication required');
  });
  it('creates run and private ownership atomically and returns only visible run IDs', async () => {
    const run: Run = { id:randomUUID(), recipient:'Atomic fixture', createdAt:new Date().toISOString(), state:'needs_review', artifacts:[], warnings:[], selectedIds:[], items:[], mode:'fixture', revision:0, approvedRevision:null, acceptedPartial:false };
    await createOwnedRun(run,owner,verify);
    expect(await getRun(run.id)).toMatchObject({ id:run.id });
    expect(await readPermission(run.id)).toMatchObject({ ownerId:owner.id, visibility:'private' });
    expect(await listOwnedRunIds(owner,verify)).toContain(run.id);
    expect(await listOwnedRunIds(lead,verify)).not.toContain(run.id);
    await changeRunVisibility(run.id,owner,'lead',0,verify);
    expect(await listOwnedRunIds(lead,verify)).toContain(run.id);
    expect(await listOwnedRunIds(member,verify)).not.toContain(run.id);
    await expect(createOwnedRun({...run,id:randomUUID()},outsider,verify)).rejects.toThrow('membership');
  });
  it('makes a new run private and denies another member, the lead, and outsiders', async () => {
    const run = runFixture();
    await createOwnedRun(run,owner,verify);
    const permission = await readPermission(run.id);
    expect(permission).toMatchObject({ ownerId:owner.id, teamId:team, visibility:'private', revision:0 });
    expect((await assertRunAccess(run.id,owner,'read',verify)).runId).toBe(run.id);
    for (const principal of [member, lead, outsider]) for (const action of ['read','edit','share','delete'] as const) {
      await expect(assertRunAccess(run.id,principal,action,verify)).rejects.toThrow('access denied');
    }
    expect((await getRun(run.id))?.recipient).toBe('Fixture');
  });

  it('permits only the owner and lead to read/edit explicitly shared runs; only the owner changes visibility', async () => {
    const run = runFixture();
    await createOwnedRun(run,owner,verify);
    const shared = await changeRunVisibility(run.id,owner,'lead',0,verify);
    expect(shared).toMatchObject({ visibility:'lead', revision:1 });
    await expect(assertRunAccess(run.id,lead,'read',verify)).resolves.toMatchObject({runId:run.id});
    await expect(assertRunAccess(run.id,lead,'edit',verify)).resolves.toMatchObject({runId:run.id});
    await expect(assertRunAccess(run.id,lead,'delete',verify)).rejects.toThrow('access denied');
    await expect(changeRunVisibility(run.id,lead,'private',1,verify)).rejects.toThrow('access denied');
    await expect(assertRunAccess(run.id,member,'read',verify)).rejects.toThrow('access denied');
    await expect(changeRunVisibility(run.id,owner,'private',0,verify)).rejects.toThrow('changed');
    await changeRunVisibility(run.id,owner,'private',1,verify);
    await expect(assertRunAccess(run.id,lead,'read',verify)).rejects.toThrow('access denied');
  });

  it('fails closed on membership revocation and never claims existing runs implicitly', async () => {
    const run = runFixture();
    await createRun(run);
    await expect(assertRunAccess(run.id,owner,'read',verify)).rejects.toThrow('access denied');
    expect(await readPermission(run.id)).toBeNull();
    await expect(createOwnedRun(run,member,verify)).rejects.toThrow();
    expect(await readPermission(run.id)).toBeNull();
    const owned = runFixture();
    await createOwnedRun(owned,owner,verify);
    revoked = new Set([owner.id]);
    await expect(assertRunAccess(owned.id,owner,'read',verify)).rejects.toThrow('access denied');
    revoked.clear();
    expect(await readPermission(owned.id)).toMatchObject({ ownerId:owner.id, visibility:'private' });
  });
});
