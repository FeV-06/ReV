import { assertLocalRequest, clientError, deleteRun, readRun, updateAction } from '@/lib/server/service';
import { readJsonLimited } from '@/lib/server/body';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{id:string}> };
export async function GET(request: Request, context: Context) {
  try { assertLocalRequest(request); return Response.json({run:await readRun((await context.params).id)}); } catch (e) { return Response.json({error:clientError(e)}, {status:400}); }
}
export async function PATCH(request: Request, context: Context) {
  try { assertLocalRequest(request); return Response.json({run:await updateAction((await context.params).id, await readJsonLimited(request, 1_000_000))}); } catch (e) { return Response.json({error:clientError(e)}, {status:400}); }
}
export async function DELETE(request: Request, context: Context) {
  try { assertLocalRequest(request); const id=(await context.params).id; await readRun(id); await deleteRun(id); return Response.json({ok:true}); } catch (e) { return Response.json({error:clientError(e)}, {status:400}); }
}
