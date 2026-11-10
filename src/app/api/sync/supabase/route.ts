import { assertLocalRequest, clientError } from '@/lib/server/request-security';
import { requestDaemon } from '@/lib/server/daemon-client';
import { readJsonLimited } from '@/lib/server/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The daemon process owns the local PGlite data directory. This endpoint never
// opens the database in the Next.js process; it proxies to the authenticated
// loopback daemon, which enforces explicit `confirmSync` consent for uploads.
export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const body = await readJsonLimited(request, 64_000);
    return await requestDaemon('/v1/sync/supabase', { method: 'POST', body });
  } catch (err) {
    return Response.json({ error: clientError(err) }, { status: 400 });
  }
}
