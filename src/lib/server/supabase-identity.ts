import { z } from 'zod';
import { validateSupabaseProjectUrl } from '@/lib/server/team-remote';
import { readJsonLimited } from '@/lib/server/body';
import type { VerifiedUser } from '@/lib/server/auth-sessions';

/** Validate an existing user access token against Supabase Auth; never trust decoded JWT claims. */
export async function verifySupabaseIdentity(input: { url: string; publishableKey: string; accessToken: string; fetchImpl?: typeof fetch }): Promise<VerifiedUser> {
  const url = validateSupabaseProjectUrl(input.url);
  if (!input.publishableKey.startsWith('sb_publishable_') || input.publishableKey.length > 2048) throw new Error('A Supabase publishable key is required');
  if (!input.accessToken || input.accessToken.length > 8192) throw new Error('An authenticated user session is required');
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(`${url}/auth/v1/user`, {
      method: 'GET', headers: { apikey: input.publishableKey, Authorization: `Bearer ${input.accessToken}` },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('Identity provider is unavailable');
  }
  if (!response.ok) throw new Error('Authentication failed or the user session expired');
  let data: unknown;
  try {
    data = await readJsonLimited(response, 64_000);
  } catch (error) {
    if (error instanceof Error && /limit|large/i.test(error.message)) throw new Error('Identity provider response is too large');
    throw new Error('Identity provider returned invalid data');
  }
  const user = z.object({ id: z.string().uuid(), email: z.string().email().max(254).optional() }).safeParse(data);
  if (!user.success) throw new Error('Identity provider returned invalid data');
  return user.data;
}
