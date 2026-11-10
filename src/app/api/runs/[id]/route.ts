import { assertLocalRequest, clientError } from '@/lib/server/request-security';
import { forwardDaemon } from '@/lib/server/daemon-client';
import { readJsonLimited } from '@/lib/server/body';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{id:string}> };
export async function GET(request: Request, context: Context) {
  try { assertLocalRequest(request); return await forwardDaemon(`/v1/runs/${encodeURIComponent((await context.params).id)}`); } catch (e) { return Response.json({error:clientError(e)}, {status:400}); }
}
export async function PATCH(request: Request, context: Context) {
  try { assertLocalRequest(request); return await forwardDaemon(`/v1/runs/${encodeURIComponent((await context.params).id)}`,{method:'PATCH',body:await readJsonLimited(request, 1_000_000)}); } catch (e) { return Response.json({error:clientError(e)}, {status:400}); }
}
export async function DELETE(request: Request, context: Context) {
  try { assertLocalRequest(request); return await forwardDaemon(`/v1/runs/${encodeURIComponent((await context.params).id)}`,{method:'DELETE'}); } catch (e) { return Response.json({error:clientError(e)}, {status:400}); }
}
export async function POST(request: Request, context: Context) {
  try {
    assertLocalRequest(request);
    const id = encodeURIComponent((await context.params).id);
    return await forwardDaemon(`/v1/runs/${id}/ask`, { method: 'POST', body: await readJsonLimited(request, 8_000) });
  } catch (error) {
    return Response.json({ error: clientError(error) }, { status: 400 });
  }
}
