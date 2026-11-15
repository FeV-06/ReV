import { teamConfigurationSchema, type TeamConfiguration } from '@/lib/team-contracts';
import { verifySupabaseIdentity } from '@/lib/server/supabase-identity';

export interface TeamSession extends TeamConfiguration { userId: string }

let activeSession: TeamSession | null = null;

export function validateSupabaseProjectUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' ||
      !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname)) {
    throw new Error('Use an HTTPS Supabase project URL ending in .supabase.co, without credentials or a path');
  }
  return url.origin;
}

export async function configureTeam(raw: unknown): Promise<{ connected: true; teamId: string; userId: string; url: string }> {
  const parsed = teamConfigurationSchema.parse(raw);
  const origin = validateSupabaseProjectUrl(parsed.url);
  const user = await verifySupabaseIdentity({ url: origin, publishableKey: parsed.publishableKey, accessToken: parsed.accessToken });

  const res = await fetch(`${origin}/rest/v1/rev_team_members?team_id=eq.${parsed.teamId}&select=team_id`, {
    headers: {
      apikey: parsed.publishableKey,
      Authorization: `Bearer ${parsed.accessToken}`,
    },
    redirect: 'error',
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error('Could not verify team membership with Supabase');
  }
  const members = await res.json() as { team_id: string }[];
  if (!Array.isArray(members) || !members.some(m => m.team_id === parsed.teamId)) {
    throw new Error('User is not a member of the requested team');
  }

  activeSession = {
    ...parsed,
    url: origin,
    userId: user.id,
  };

  return { connected: true, teamId: activeSession.teamId, userId: activeSession.userId, url: activeSession.url };
}

export function currentTeam(): TeamSession {
  if (!activeSession) {
    throw new Error('Team connection is not configured');
  }
  return activeSession;
}

export function teamSessionStatus(): { connected: boolean; teamId?: string; userId?: string; url?: string } {
  if (!activeSession) return { connected: false };
  return { connected: true, teamId: activeSession.teamId, userId: activeSession.userId, url: activeSession.url };
}

export function disconnectTeam(): void {
  activeSession = null;
}

export async function teamRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const session = currentTeam();
  const res = await fetch(`${session.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: session.publishableKey,
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    redirect: 'error',
    cache: 'no-store',
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Team RPC ${name} failed (${res.status}): ${errorText}`);
  }
  return await res.json();
}
