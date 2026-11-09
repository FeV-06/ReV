import { assertLocalRequest, clientError, listRuns, newRun } from '@/lib/server/service';
import { requestDaemon } from '@/lib/server/daemon-client';
import { readJsonLimited } from '@/lib/server/body';
import { connectedSources } from '@/lib/server/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
  } catch (e) {
    return Response.json({ error: clientError(e) }, { status: 403 });
  }
  try {
    const upstream = await requestDaemon('/v1/runs');
    if (upstream.ok) {
      const data = await upstream.json() as { runs: unknown[]; sources?: unknown };
      return Response.json({
        runs: data.runs,
        sources: data.sources ?? await connectedSources()
      });
    }
  } catch {}
  try {
    return Response.json({ runs: await listRuns(), sources: await connectedSources() });
  } catch (e) {
    return Response.json({ error: clientError(e) }, { status: 500 });
  }
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
    const upstream = await requestDaemon('/v1/runs', { method: 'POST', body });
    if (upstream.ok) {
      return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json' } });
    }
  } catch {}
  try {
    return Response.json({ run: await newRun(body) });
  } catch (e) {
    return Response.json({ error: clientError(e) }, { status: 400 });
  }
}
