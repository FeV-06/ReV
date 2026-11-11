import { randomUUID } from 'node:crypto';
import { database } from '@/lib/server/store';
import type { Run } from '@/lib/contracts';
import { assertRunAccess, ensurePermissionSchema, type Principal, type MembershipVerifier } from '@/lib/server/run-permissions';

/** Atomically create a private handover and its owner record. Existing runs cannot be claimed. */
export async function createOwnedRun(run: Run, principal: Principal, verify: MembershipVerifier): Promise<void> {
  if (!await verify(principal)) throw new Error('Team membership required');
  await ensurePermissionSchema();
  const db = await database();
  await db.transaction(async tx => {
    await tx.query('INSERT INTO runs(id,created_at,payload) VALUES($1,$2,$3::jsonb)', [run.id, run.createdAt, JSON.stringify(run)]);
    await tx.query("INSERT INTO run_permissions(run_id,team_id,owner_id,visibility) VALUES($1,$2,$3,'private')", [run.id, principal.teamId, principal.id]);
    await tx.query("INSERT INTO run_permission_events(id,run_id,team_id,actor_id,old_visibility,new_visibility) VALUES($1,$2,$3,$4,NULL,'private')", [randomUUID(),run.id,principal.teamId,principal.id]);
  });
}

/** Query only the current identity's own runs and explicitly lead-shared runs. */
export async function listOwnedRunIds(principal: Principal, verify: MembershipVerifier): Promise<string[]> {
  const role = await verify(principal);
  if (!role) throw new Error('Team membership required');
  await ensurePermissionSchema();
  const result = await (await database()).query<{run_id:string}>(`SELECT p.run_id FROM run_permissions p JOIN runs r ON r.id=p.run_id
    WHERE p.team_id=$1 AND (p.owner_id=$2 OR ($3='leader' AND p.visibility='lead')) ORDER BY r.created_at DESC`, [principal.teamId,principal.id,role]);
  return result.rows.map(row => row.run_id);
}

export interface AuthorizationDependencies {
  requireSession(credential: string | undefined): { user: { id: string } };
  teamId: string;
  verifyMembership: MembershipVerifier;
}

/** Single server-side entry point for run actions, independent of UI roles. */
export async function authorizeOwnedRun(
  credential: string | undefined,
  runId: string,
  action: import('@/lib/server/run-permissions').RunAccess,
  dependencies: AuthorizationDependencies,
) {
  const session = dependencies.requireSession(credential);
  const principal: Principal = { id: session.user.id, teamId: dependencies.teamId };
  await assertRunAccess(runId, principal, action, dependencies.verifyMembership);
  return principal;
}
