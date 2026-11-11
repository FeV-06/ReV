import { assertLocalRequest, clientError } from '@/lib/server/service';
import { requestDaemon } from '@/lib/server/daemon-client';
import { readJsonLimited } from '@/lib/server/body';

import { browserUserSession } from '@/lib/server/browser-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
  } catch (e) {
    return Response.json({ error: clientError(e) }, { status: 403 });
  }
  try {
    const upstream = await requestDaemon('/v1/runs', { userSession: browserUserSession(request) });
    return new Response(upstream.body, { status: upstream.status, headers: {'content-type':'application/json','cache-control':'no-store'} });
  } catch { return Response.json({error:'ReV daemon is unavailable'}, {status:503}); }
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
  } catch (e) {
    return Response.json({ error: clientError(e) }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await readJsonLimited(request, 15_000_000);
  } catch (e) {
    return Response.json({ error: clientError(e) }, { status: 400 });
  }
  try {
    const upstream = await requestDaemon('/v1/runs', { method: 'POST', body, userSession: browserUserSession(request) });
    return new Response(upstream.body, { status: upstream.status, headers: {'content-type':'application/json','cache-control':'no-store'} });
  } catch { return Response.json({error:'ReV daemon is unavailable'}, {status:503}); }
}
