import { assertLocalRequest, clientError, readGraph } from '@/lib/server/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request, context:{params:Promise<{id:string}>}) {
  try { assertLocalRequest(request); return Response.json({graph:await readGraph((await context.params).id)}); }
  catch(e) { return Response.json({error:clientError(e)},{status:400}); }
}
