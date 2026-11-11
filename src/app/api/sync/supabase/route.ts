import { assertLocalRequest, clientError } from '@/lib/server/request-security';
import { readJsonLimited } from '@/lib/server/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Fail closed: this old bulk exporter lacks authenticated, per-user team policy.
export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    await readJsonLimited(request, 64_000);
    return Response.json({ success: false, error: 'Legacy bulk sync is disabled: it cannot enforce per-user team permissions.' }, { status: 403 });
  } catch (err) {
    return Response.json({ error: clientError(err) }, { status: 400 });
  }
}
