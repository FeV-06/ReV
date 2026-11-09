import { assertLocalRequest, clientError, listRuns, newRun } from '@/lib/server/service';
import { readJsonLimited } from '@/lib/server/body';
import { connectedSources } from '@/lib/server/sources';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { assertLocalRequest(request); return Response.json({runs:await listRuns(), sources:await connectedSources()}); } catch (e) { return Response.json({error:clientError(e)}, {status:403}); }
}
export async function POST(request: Request) {
  try { assertLocalRequest(request); return Response.json({run:await newRun(await readJsonLimited(request, 15_000_000))}); }
  catch (e) { return Response.json({error:clientError(e)}, {status:400}); }
}
