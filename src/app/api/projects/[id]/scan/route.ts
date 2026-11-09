import { assertLocalRequest, clientError } from '@/lib/server/request-security';
import { forwardDaemon } from '@/lib/server/daemon-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try { assertLocalRequest(request); } catch (e) { return Response.json({ error: clientError(e) }, { status: 403 }); }
  try {
    const id = encodeURIComponent((await context.params).id);
    return await forwardDaemon(`/v1/projects/${id}/scan`, { method: 'POST' });
  } catch (e) {
    return Response.json({ error: clientError(e) }, { status: 503 });
  }
}
