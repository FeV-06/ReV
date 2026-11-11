import { createHash, randomUUID } from 'node:crypto';
import { database } from '@/lib/server/store';

export type Visibility = 'private' | 'lead';
export type RunAccess = 'read' | 'edit' | 'share' | 'delete';
export interface Principal { id: string; teamId: string; }
export interface Permission {
  runId: string;
  ownerId: string;
  teamId: string;
  visibility: Visibility;
  revision: number;
}

/** Server-side membership lookup; client-provided role labels are never authority. */
export type MembershipVerifier = (principal: Principal) => Promise<'leader' | 'member' | null>;

export async function ensurePermissionSchema(): Promise<void> {
  await (await database()).exec(`CREATE TABLE IF NOT EXISTS run_permissions (
    run_id UUID PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    team_id UUID NOT NULL,
    owner_id UUID NOT NULL,
    visibility TEXT NOT NULL CHECK (visibility IN ('private', 'lead')),
    revision BIGINT NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS run_permission_events (
    id UUID PRIMARY KEY, run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    team_id UUID NOT NULL, actor_id UUID NOT NULL, old_visibility TEXT,
    new_visibility TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);
}

function normalized(row: { run_id: string; owner_id: string; team_id: string; visibility: Visibility; revision: string | number }): Permission {
  return { runId: row.run_id, ownerId: row.owner_id, teamId: row.team_id, visibility: row.visibility, revision: Number(row.revision) };
}

type PermissionRow = { run_id: string; owner_id: string; team_id: string; visibility: Visibility; revision: string | number };

export async function readPermission(runId: string): Promise<Permission | null> {
  await ensurePermissionSchema();
  const result = await (await database()).query<PermissionRow>('SELECT * FROM run_permissions WHERE run_id=$1', [runId]);
  return result.rows[0] ? normalized(result.rows[0]) : null;
}

export async function assertRunAccess(runId: string, principal: Principal, action: RunAccess, verify: MembershipVerifier): Promise<Permission> {
  const role = await verify(principal);
  const permission = await readPermission(runId);
  // Identical result for missing and forbidden avoids exposing IDs through error differences.
  if (!role || !permission || permission.teamId !== principal.teamId) throw new Error('Handover not found or access denied');
  const owner = permission.ownerId === principal.id;
  const leadCanAccess = role === 'leader' && permission.visibility === 'lead';
  if (action === 'share' || action === 'delete') {
    if (!owner) throw new Error('Handover not found or access denied');
  } else if (!owner && !leadCanAccess) {
    throw new Error('Handover not found or access denied');
  }
  return permission;
}

/** Only the owner changes sharing; version check prevents concurrent policy updates from silently winning. */
export async function changeRunVisibility(runId: string, principal: Principal, visibility: Visibility, expectedRevision: number, verify: MembershipVerifier): Promise<Permission> {
  if (!['private', 'lead'].includes(visibility) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Invalid visibility update');
  const role = await verify(principal);
  if (!role) throw new Error('Handover not found or access denied');
  await ensurePermissionSchema();
  const db = await database();
  return db.transaction(async tx => {
    const current = await tx.query<PermissionRow>('SELECT * FROM run_permissions WHERE run_id=$1 FOR UPDATE', [runId]);
    const row = current.rows[0];
    if (!row || row.owner_id !== principal.id || row.team_id !== principal.teamId) throw new Error('Handover not found or access denied');
    if (Number(row.revision) !== expectedRevision) throw new Error('Sharing settings changed in another session; reload');
    if (row.visibility === visibility) return normalized(row);
    const next = await tx.query<PermissionRow>('UPDATE run_permissions SET visibility=$2,revision=revision+1 WHERE run_id=$1 RETURNING *', [runId, visibility]);
    await tx.query('INSERT INTO run_permission_events(id,run_id,team_id,actor_id,old_visibility,new_visibility) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), runId, principal.teamId, principal.id, row.visibility, visibility]);
    return normalized(next.rows[0]);
  });
}

/** Used only for security audit correlation; never treat the fingerprint as authority. */
export function principalFingerprint(principal: Principal): string {
  return createHash('sha256').update(`${principal.teamId}:${principal.id}`).digest('hex');
}
