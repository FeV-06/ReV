import { assertLocalRequest, clientError, deleteRun, readRun, updateAction } from '@/lib/server/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{id:string}> };
export async function GET(request: Request, context: Context) {
  try { assertLocalRequest(request); return Response.json({run:await readRun((await context.params).id)}); } catch (e) { return Response.json({error:clientError(e)}, {status:400}); }
}
export async function PATCH(request: Request, context: Context) {
  try { assertLocalRequest(request); return Response.json({run:await updateAction((await context.params).id, await request.json())}); } catch (e) { return Response.json({error:clientError(e)}, {status:400}); }
}
export async function DELETE(request: Request, context: Context) {
  try { assertLocalRequest(request); const id=(await context.params).id; await readRun(id); await deleteRun(id); return Response.json({ok:true}); } catch (e) { return Response.json({error:clientError(e)}, {status:400}); }
}
