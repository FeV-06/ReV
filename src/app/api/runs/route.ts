import { assertLocalRequest, clientError, listRuns, newRun } from '@/lib/server/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { assertLocalRequest(request); return Response.json({runs:await listRuns()}); } catch (e) { return Response.json({error:clientError(e)}, {status:403}); }
}
export async function POST(request: Request) {
  try { assertLocalRequest(request); const length = Number(request.headers.get('content-length') || 0); if (length > 15_000_000) throw new Error('Request too large'); return Response.json({run:await newRun(await request.json())}); }
  catch (e) { return Response.json({error:clientError(e)}, {status:400}); }
}
