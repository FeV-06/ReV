import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { verifySupabaseMembership } from '@/lib/server/supabase-membership';

describe('Supabase team membership verification', () => {
  const principal = { id: randomUUID(), teamId: randomUUID() };
  const base = { url:'https://project.supabase.co', publishableKey:'sb_publishable_test', accessToken:'user-jwt', principal };

  it('uses a server-returned team role for the specific verified identity', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json([{ team_id:principal.teamId, member_user_id:principal.id, member_role:'member' }]));
    await expect(verifySupabaseMembership({ ...base, fetchImpl })).resolves.toBe('member');
    const request = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(request.searchParams.get('team_id')).toBe(`eq.${principal.teamId}`);
    expect(request.searchParams.get('member_user_id')).toBe(`eq.${principal.id}`);
  });

  it('denies absent, wrong-user, wrong-team and unrecognized role responses', async () => {
    for (const rows of [[], [{team_id:principal.teamId,member_user_id:randomUUID(),member_role:'leader'}], [{team_id:randomUUID(),member_user_id:principal.id,member_role:'leader'}]]) {
      await expect(verifySupabaseMembership({ ...base, fetchImpl:vi.fn().mockResolvedValue(Response.json(rows)) })).resolves.toBeNull();
    }
    await expect(verifySupabaseMembership({ ...base, fetchImpl:vi.fn().mockResolvedValue(Response.json([{team_id:principal.teamId,member_user_id:principal.id,member_role:'admin'}])) })).rejects.toThrow('Invalid membership response');
  });

  it('fails closed when the authorization service is unavailable', async () => {
    await expect(verifySupabaseMembership({ ...base, fetchImpl:vi.fn().mockRejectedValue(new Error('offline')) })).rejects.toThrow('Could not verify');
    await expect(verifySupabaseMembership({ ...base, fetchImpl:vi.fn().mockResolvedValue(new Response('', {status:401})) })).rejects.toThrow('Could not verify');
  });
});
