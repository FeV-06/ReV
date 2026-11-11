import { assertLocalRequest, clientError } from '@/lib/server/request-security';
import { forwardDaemon } from '@/lib/server/daemon-client';
import { browserUserSession } from '@/lib/server/browser-session';
import { readJsonLimited } from '@/lib/server/body';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context) {
  try { assertLocalRequest(request); return await forwardDaemon(`/v1/runs/${encodeURIComponent((await context.params).id)}/visibility`,{userSession:browserUserSession(request)}); }
  catch(error){return Response.json({error:clientError(error)},{status:400});}
}
export async function PATCH(request:Request,context:Context) {
  try { assertLocalRequest(request); return await forwardDaemon(`/v1/runs/${encodeURIComponent((await context.params).id)}/visibility`,{method:'PATCH',body:await readJsonLimited(request,4_000),userSession:browserUserSession(request)}); }
  catch(error){return Response.json({error:clientError(error)},{status:400});}
}
