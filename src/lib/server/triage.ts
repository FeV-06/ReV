import { z } from 'zod';
import type { Artifact } from '@/lib/contracts';

export type TriageCategory = 'architectural_decision' | 'open_work' | 'risk' | 'cosmetic_churn' | 'other';

export const triageResultSchema = z.object({
  category: z.enum(['architectural_decision', 'open_work', 'risk', 'cosmetic_churn', 'other']),
  confidence: z.number().min(0).max(1),
  isSignificant: z.boolean(),
  reason: z.string(),
});

export type TriageResult = z.infer<typeof triageResultSchema>;

/**
 * Fast, deterministic triage heuristics based on the verified Laya classification baseline rules.
 * Automatically identifies and prunes cosmetic churn (formatting, version bumps, typos, style-only)
 * before heavy LLM reasoning payloads are prepared.
 */
export function triageArtifact(artifact: Pick<Artifact, 'kind' | 'text' | 'paths'>): TriageResult {
  const text = (artifact.text || '').toLowerCase();
  const paths = (artifact.paths || []).map((p) => p.toLowerCase());

  // 1. Detect Cosmetic Churn
  const isCosmeticPath = paths.length > 0 && paths.every((p) =>
    p.endsWith('.lock') ||
    p.endsWith('-lock.json') ||
    p.endsWith('-lock.yaml') ||
    p.includes('.prettierrc') ||
    p.includes('.eslintrc') ||
    p.includes('tsconfig.tsbuildinfo')
  );

  const cosmeticKeywords = [
    'bump version',
    'bump dependencies',
    'format code',
    'run prettier',
    'fix typo',
    'update dependencies',
    'lockfile update',
    'update lockfile',
    'cleanup formatting',
    'whitespace change',
    'lint fix',
  ];

  if (isCosmeticPath || cosmeticKeywords.some((kw) => text.includes(kw))) {
    return {
      category: 'cosmetic_churn',
      confidence: 0.95,
      isSignificant: false,
      reason: 'Routine cosmetic churn, dependency bump, or lockfile modification.',
    };
  }

  // 2. Detect Architectural Decisions
  const decisionKeywords = [
    'decision:',
    'we decided',
    'we agreed',
    'team chose',
    'approved:',
    'we rejected',
    'architecture:',
    'design decision',
    'rfc:',
    'adr:',
    'selected ',
  ];

  if (decisionKeywords.some((kw) => text.includes(kw))) {
    return {
      category: 'architectural_decision',
      confidence: 0.9,
      isSignificant: true,
      reason: 'Explicit architectural or technical decision documented in message or commit.',
    };
  }

  // 3. Detect Risks & Breakages
  const riskKeywords = [
    'risk:',
    'might corrupt',
    'will stop working',
    'single node failure',
    'may lose',
    'bypass',
    'can break',
    'hypothetical outage',
    'breaking change',
    'deprecated',
    'vulnerability',
    'race condition',
  ];

  if (riskKeywords.some((kw) => text.includes(kw))) {
    return {
      category: 'risk',
      confidence: 0.88,
      isSignificant: true,
      reason: 'Identified fragility, deprecation, or potential failure mode.',
    };
  }

  // 4. Detect Open Work
  const openWorkKeywords = [
    'todo:',
    'follow up:',
    'outstanding:',
    'please ',
    'unfinished',
    'create a rollback',
    'fixme:',
    'in progress',
  ];

  if (openWorkKeywords.some((kw) => text.includes(kw))) {
    return {
      category: 'open_work',
      confidence: 0.85,
      isSignificant: true,
      reason: 'Unresolved technical task or follow-up item.',
    };
  }

  return {
    category: 'other',
    confidence: 0.7,
    isSignificant: true,
    reason: 'Standard commit or message without flagged cosmetic indicators.',
  };
}

/**
 * Filter an array of artifacts, separating significant architectural evidence from noise.
 */
export function pruneCosmeticArtifacts<T extends Pick<Artifact, 'kind' | 'text' | 'paths'>>(
  artifacts: T[]
): { significant: T[]; pruned: { artifact: T; triage: TriageResult }[] } {
  const significant: T[] = [];
  const pruned: { artifact: T; triage: TriageResult }[] = [];

  for (const artifact of artifacts) {
    const triage = triageArtifact(artifact);
    if (triage.isSignificant) {
      significant.push(artifact);
    } else {
      pruned.push({ artifact, triage });
    }
  }

  return { significant, pruned };
}
