import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Run } from '@/lib/contracts';
import { z } from 'zod';
import { callCore } from './core';

const exec = promisify(execFile);

export const moduleRiskSchema = z.object({
  path: z.string(),
  totalLines: z.number().int().nonnegative(),
  departingLines: z.number().int().nonnegative(),
  ownershipFraction: z.number().min(0).max(1),
  churnLines: z.number().int().nonnegative(),
  testCoverage: z.number().min(0).max(1).nullable().optional(),
  score: z.number().nonnegative(),
  explanation: z.string(),
});

export const riskAnalysisSchema = z.object({
  revision: z.string(),
  modules: z.array(moduleRiskSchema),
  warnings: z.array(z.string()),
});

export type ModuleRisk = z.infer<typeof moduleRiskSchema>;
export type RiskAnalysis = z.infer<typeof riskAnalysisSchema>;

export async function analyzeRepositoryRisk(options: {
  repoPath: string;
  emails: string[];
  maxFiles?: number;
}): Promise<RiskAnalysis> {
  if (!options.emails.length) {
    throw new Error('At least one author email is required for bus-factor ownership analysis.');
  }

  const raw = await callCore({
    op: 'analyze_local_risk',
    path: options.repoPath,
    emails: options.emails,
    maxFiles: options.maxFiles || 100,
  });

  return riskAnalysisSchema.parse(raw);
}

const riskRequestSchema = z.object({
  emails: z.array(z.string().email().or(z.string().min(1))).optional(),
  repoPath: z.string().optional(),
  maxFiles: z.number().int().min(1).max(500).optional(),
});

export async function analyzeRunRisk(run: Run, input: unknown) {
  const parsed = riskRequestSchema.parse(input ?? {});
  const localCommits = run.artifacts.filter(artifact => artifact.kind === 'git_commit' && artifact.url === null);
  if (run.mode === 'fixture' || (!run.projectRoot && !parsed.repoPath && !localCommits.length)) {
    throw new Error('Bus-factor analysis requires a run imported from a local Git checkout. Create a live run using local Git history.');
  }

  const identities = [run.departingPerson, run.githubUsername].flatMap(value => value ? [value.trim().toLowerCase()] : []);
  const repoPath = path.resolve(parsed.repoPath || run.projectRoot || process.env.REV_GIT_DIR || process.cwd());
  const emails = new Set(parsed.emails?.length ? parsed.emails : identities.filter(value => /^[^\s<>@]+@[^\s<>@]+$/.test(value)));
  if (!parsed.emails?.length) {
    const matchingCommits = new Set<string>();
    for (const artifact of localCommits) {
      const match = /^(.*?)\s*<([^<>]+)>$/.exec(artifact.author ?? '');
      const [, name, email] = match ?? [];
      if ([name, email, artifact.author, artifact.githubLogin].some(value => value && identities.includes(value.trim().toLowerCase()))) {
        if (email) emails.add(email);
        else if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(artifact.externalId)) matchingCommits.add(artifact.externalId);
      }
    }
    if (matchingCommits.size) {
      const { stdout } = await exec('git', ['-C', repoPath, 'log', '--no-walk', '--format=%ae', ...matchingCommits, '--'], { timeout: 15_000 })
        .catch(() => { throw new Error('Could not read the imported commits. Check that the original local Git checkout is available.'); });
      for (const email of stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) emails.add(email);
    }
  }
  if (!emails.size) {
    throw new Error('No Git author email matched the departing contributor. Set the contributor to their Git author name or email.');
  }

  const analysis = await analyzeRepositoryRisk({
    repoPath,
    emails: [...emails],
    maxFiles: parsed.maxFiles || 100,
  });

  return { runId: run.id, analysis };
}
