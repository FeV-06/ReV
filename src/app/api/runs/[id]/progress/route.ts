import { assertLocalRequest, clientError } from '@/lib/server/request-security';
import { forwardDaemon } from '@/lib/server/daemon-client';
import { browserUserSession } from '@/lib/server/browser-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    assertLocalRequest(request);
    const id = encodeURIComponent((await context.params).id);
    return await forwardDaemon(`/v1/runs/${id}/progress`, { userSession: browserUserSession(request) });
  } catch (error) {
    return Response.json({ error: clientError(error) }, { status: 400 });
  }
}
