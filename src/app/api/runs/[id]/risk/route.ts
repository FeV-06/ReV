import { assertLocalRequest, clientError } from '@/lib/server/request-security';
import { readJsonLimited } from '@/lib/server/body';
import { forwardDaemon } from '@/lib/server/daemon-client';
import { browserUserSession } from '@/lib/server/browser-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalRequest(request);
    const id = encodeURIComponent((await context.params).id);
    return await forwardDaemon(`/v1/runs/${id}/risk`, {
      method: 'POST',
      body: await readJsonLimited(request, 64_000),
      userSession: browserUserSession(request),
    });
  } catch (error) {
    return Response.json({ error: clientError(error) }, { status: 400 });
  }
}
