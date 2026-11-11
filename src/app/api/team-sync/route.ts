import { z } from 'zod';
import { requestDaemon } from '@/lib/server/daemon-client';
import { readJsonLimited } from '@/lib/server/body';
import { assertLocalRequest } from '@/lib/server/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const input = z.object({ action: z.enum(['configure', 'status', 'preview', 'sync']),
      projectRoot: z.string().optional(), previewId: z.string().optional(), shareAnalysis: z.boolean().optional(),
      sharedRunIds: z.array(z.string()).optional(), confirm: z.boolean().optional(),
      url: z.string().optional(), publishableKey: z.string().optional(), accessToken: z.string().optional(), teamId: z.string().optional(),
    }).strict().parse(await readJsonLimited(request, 100_000));
    const { action, ...payload } = input;
    return await requestDaemon('/v1/team-sync', { method: 'POST', body: { action, payload } });
  } catch {
    return Response.json({ ok: false, action: 'unknown', error: 'Could not reach the team service or invalid request.' }, { status: 400 });
  }
}
