import { describe, it, expect } from 'vitest';
import { triageArtifact, pruneCosmeticArtifacts } from '../src/lib/server/triage';

describe('Laya Semantic Triage & Noise Pruning (Milestone 5)', () => {
  it('identifies cosmetic lockfile churn and bumps as not significant', () => {
    const lockfileArtifact = {
      kind: 'git_commit' as const,
      text: 'chore: bump dependencies and update lockfile',
      paths: ['pnpm-lock.yaml', 'package.json'],
    };
    const triage = triageArtifact(lockfileArtifact);
    expect(triage.category).toBe('cosmetic_churn');
    expect(triage.isSignificant).toBe(false);
    expect(triage.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('identifies architectural decisions with high confidence', () => {
    const decisionArtifact = {
      kind: 'git_commit' as const,
      text: 'Decision: Selected Postgres with PGlite for local-first zero-install storage',
      paths: ['src/lib/server/store.ts'],
    };
    const triage = triageArtifact(decisionArtifact);
    expect(triage.category).toBe('architectural_decision');
    expect(triage.isSignificant).toBe(true);
    expect(triage.reason).toContain('architectural');
  });

  it('identifies risks and potential failures', () => {
    const riskArtifact = {
      kind: 'slack_message' as const,
      text: 'Risk: Single node failure might corrupt uncommitted state during hard reboot',
      paths: [],
    };
    const triage = triageArtifact(riskArtifact);
    expect(triage.category).toBe('risk');
    expect(triage.isSignificant).toBe(true);
  });

  it('prunes noise from a mixed collection of artifacts', () => {
    const items = [
      { kind: 'git_commit' as const, text: 'fix typo in docs', paths: ['README.md'] },
      { kind: 'git_commit' as const, text: 'bump version to 0.2.0', paths: ['package.json'] },
      { kind: 'git_commit' as const, text: 'ADR: Migrate to Tree-sitter for AST symbol extraction', paths: ['crates/rev-core/src/symbols.rs'] },
      { kind: 'git_commit' as const, text: 'TODO: Create rollback script for migration 0002', paths: ['supabase/migrations/0002_rpc_api.sql'] },
    ];

    const { significant, pruned } = pruneCosmeticArtifacts(items);
    expect(significant).toHaveLength(2);
    expect(pruned).toHaveLength(2);
    expect(significant[0].text).toContain('ADR: Migrate to Tree-sitter');
    expect(significant[1].text).toContain('TODO: Create rollback');
  });
});
