import { assertLocalRequest, clientError } from '@/lib/server/request-security';
import { forwardDaemon } from '@/lib/server/daemon-client';
import { readJsonLimited } from '@/lib/server/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try { assertLocalRequest(request); } catch (e) { return Response.json({ error: clientError(e) }, { status: 403 }); }
  try {
    const id = encodeURIComponent((await context.params).id);
    return await forwardDaemon(`/v1/projects/${id}`);
  } catch (e) {
    return Response.json({ error: clientError(e) }, { status: 503 });
  }
}

export async function PATCH(request: Request, context: Context) {
  try { assertLocalRequest(request); } catch (e) { return Response.json({ error: clientError(e) }, { status: 403 }); }
  let body: unknown;
  try { body = await readJsonLimited(request, 4_000); } catch (e) { return Response.json({ error: clientError(e) }, { status: 400 }); }
  try {
    const id = encodeURIComponent((await context.params).id);
    return await forwardDaemon(`/v1/projects/${id}`, { method: 'PATCH', body });
  } catch (e) {
    return Response.json({ error: clientError(e) }, { status: 503 });
  }
}

export async function DELETE(request: Request, context: Context) {
  try { assertLocalRequest(request); } catch (e) { return Response.json({ error: clientError(e) }, { status: 403 }); }
  try {
    const id = encodeURIComponent((await context.params).id);
    return await forwardDaemon(`/v1/projects/${id}`, { method: 'DELETE' });
  } catch (e) {
    return Response.json({ error: clientError(e) }, { status: 503 });
  }
}
