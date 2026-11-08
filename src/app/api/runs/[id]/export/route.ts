import { assertLocalRequest, clientError, exportMarkdown, readRun } from '@/lib/server/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {params:Promise<{id:string}>}) {
  try { assertLocalRequest(request); const run=await readRun((await context.params).id); return new Response(exportMarkdown(run), {headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':'attachment; filename="rev-handover.md"','Cache-Control':'no-store'}}); }
  catch(e) { return Response.json({error:clientError(e)}, {status:400}); }
}
