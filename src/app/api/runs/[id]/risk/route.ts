import { assertLocalRequest, clientError } from '@/lib/server/request-security';
import { readJsonLimited } from '@/lib/server/body';
import { getRun } from '@/lib/server/store';
import { analyzeRepositoryRisk } from '@/lib/server/risk';
import { z } from 'zod';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const riskRequestSchema = z.object({
  emails: z.array(z.string().email().or(z.string().min(1))).optional(),
  repoPath: z.string().optional(),
  maxFiles: z.number().int().min(1).max(500).optional(),
});

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    assertLocalRequest(request);
    const { id } = await props.params;
    const run = await getRun(id);
    if (!run) {
      return Response.json({ error: 'Run not found' }, { status: 404 });
    }

    const body = await readJsonLimited(request, 64_000);
    const parsed = riskRequestSchema.parse(body || {});

    // Derive emails from run departingPerson / artifacts if not explicitly passed
    const emails: string[] = [];
    if (parsed.emails && parsed.emails.length > 0) {
      emails.push(...parsed.emails);
    } else {
      if (run.departingPerson) emails.push(run.departingPerson);
      if (run.githubUsername) emails.push(run.githubUsername);
      // Scan artifacts for contributor author emails if present
      for (const a of run.artifacts) {
        if (a.author && (a.author.includes('@') || a.author === run.githubUsername)) {
          emails.push(a.author);
        }
      }
    }

    if (!emails.length) {
      return Response.json(
        { error: 'No departing engineer email or handle configured for this run' },
        { status: 400 }
      );
    }

    const repoPath = parsed.repoPath || run.projectRoot || process.cwd();

    const analysis = await analyzeRepositoryRisk({
      repoPath: path.resolve(repoPath),
      emails,
      maxFiles: parsed.maxFiles || 100,
    });

    return Response.json({
      runId: run.id,
      analysis,
    });
  } catch (error) {
    return Response.json({ error: clientError(error) }, { status: 400 });
  }
}
