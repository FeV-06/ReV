import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyzeRepositoryRisk } from '../src/lib/server/risk';

describe('analyzeRepositoryRisk Server Bridge (Milestone 4 - Phase 1)', () => {
  it('invokes Rust core via callCore and parses strongly typed RiskAnalysis', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rev-risk-bridge-'));
    try {
      const git = (args: string[], author = 'alice@example.invalid') =>
        execFileSync('git', ['-C', dir, ...args], {
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: author,
            GIT_AUTHOR_EMAIL: author,
            GIT_COMMITTER_NAME: author,
            GIT_COMMITTER_EMAIL: author,
          },
          stdio: 'pipe',
        });

      git(['init', '-b', 'main']);
      await writeFile(path.join(dir, 'core.ts'), 'export const core = 1;\nexport const secondary = 2;\n');
      git(['add', 'core.ts']);
      git(['commit', '-m', 'initial core']);

      const analysis = await analyzeRepositoryRisk({
        repoPath: dir,
        emails: ['alice@example.invalid'],
        maxFiles: 50,
      });

      expect(analysis).toBeDefined();
      expect(analysis.revision).toMatch(/^[0-9a-f]{40,64}$/);
      expect(analysis.modules).toHaveLength(1);
      const mod = analysis.modules[0];
      expect(mod.path).toBe('core.ts');
      expect(mod.ownershipFraction).toBe(1.0);
      expect(mod.departingLines).toBe(2);
      expect(mod.totalLines).toBe(2);
      expect(mod.score).toBeGreaterThan(0);
      expect(mod.explanation).toContain('HEAD blame');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects with error when empty emails array is supplied', async () => {
    await expect(
      analyzeRepositoryRisk({
        repoPath: process.cwd(),
        emails: [],
      })
    ).rejects.toThrow('At least one author email is required');
  });
});
