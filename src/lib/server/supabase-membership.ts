import { z } from 'zod';
import { validateSupabaseProjectUrl } from '@/lib/server/team-remote';
import { readJsonLimited } from '@/lib/server/body';
import type { Principal } from '@/lib/server/run-permissions';

/** Query RLS-protected membership under the user's own Supabase bearer token. */
export async function verifySupabaseMembership(input: {
  url: string;
  publishableKey: string;
  accessToken: string;
  principal: Principal;
  fetchImpl?: typeof fetch;
}): Promise<'leader' | 'member' | null> {
  const origin = validateSupabaseProjectUrl(input.url);
  if (!input.publishableKey.startsWith('sb_publishable_') || !input.accessToken) throw new Error('Authenticated Supabase session required');
  const parsed = z.object({ id: z.string().uuid(), teamId: z.string().uuid() }).strict().parse(input.principal);
  const query = new URLSearchParams({ select: 'team_id,member_user_id,member_role', team_id: `eq.${parsed.teamId}`, member_user_id: `eq.${parsed.id}` });
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(`${origin}/rest/v1/rev_team_members?${query.toString()}`, {
      headers: { apikey: input.publishableKey, Authorization: `Bearer ${input.accessToken}` },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new Error('Could not verify team membership'); }
  if (!response.ok) throw new Error('Could not verify team membership');
  let value: unknown;
  try { value = await readJsonLimited(response, 64_000); } catch { throw new Error('Invalid membership response'); }
  const result = z.array(z.object({ team_id:z.string().uuid(), member_user_id:z.string().uuid(), member_role:z.enum(['leader','member']) }).strict()).max(1).safeParse(value);
  if (!result.success) throw new Error('Invalid membership response');
  const row = result.data[0];
  if (!row || row.team_id !== parsed.teamId || row.member_user_id !== parsed.id) return null;
  return row.member_role;
}
