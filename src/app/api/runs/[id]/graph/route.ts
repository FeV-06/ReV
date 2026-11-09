import { assertLocalRequest, clientError } from '@/lib/server/request-security';
import { forwardDaemon } from '@/lib/server/daemon-client';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request, context:{params:Promise<{id:string}>}) {
  try { assertLocalRequest(request); return await forwardDaemon(`/v1/runs/${encodeURIComponent((await context.params).id)}/graph`); }
  catch(e) { return Response.json({error:clientError(e)},{status:400}); }
}
