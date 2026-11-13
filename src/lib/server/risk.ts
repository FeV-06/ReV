import { z } from 'zod';
import { callCore } from './core';

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
