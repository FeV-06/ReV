import type { TeamConfiguration } from '@/lib/team-contracts';

export interface TeamSession extends TeamConfiguration { userId: string }


export function validateSupabaseProjectUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' ||
      !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname)) {
    throw new Error('Use an HTTPS Supabase project URL ending in .supabase.co, without credentials or a path');
  }
  return url.origin;
}

export async function configureTeam(raw: unknown): Promise<{ connected: true; teamId: string; userId: string; url: string }> {
  void raw;
  throw new Error('Team sync is disabled until authorization and sharing boundaries are verified.');
}

export function currentTeam(): TeamSession {
  throw new Error('Team sync is disabled until authorization and sharing boundaries are verified.');
}

export function teamSessionStatus(): { connected: boolean; teamId?: string; userId?: string; url?: string } {
  return { connected: false };
}

export function disconnectTeam(): void { /* No active team session exists while disabled. */ }

export async function teamRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  void name;
  void args;
  throw new Error('Team sync is disabled until authorization and sharing boundaries are verified.');
}
