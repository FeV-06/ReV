import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyzeRepositoryRisk, analyzeRunRisk } from '../src/lib/server/risk';
import { importLocalGit } from '../src/lib/server/sources';
import { randomUUID } from 'node:crypto';

describe('analyzeRepositoryRisk Server Bridge (Milestone 4 - Phase 1)', () => {
  it('invokes Rust core via callCore and parses strongly typed RiskAnalysis', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rev-risk-bridge-'));
    try {
      const git = (args: string[], author = 'alice@example.invalid') =>
        execFileSync('git', ['-C', dir, ...args], {
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'Alice',
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

      const { artifacts } = await importLocalGit({ projectDir: dir, authors: ['Alice'], includeSymbols: false, includeWorkspaceChanges: false });
      expect(artifacts[0].author).toBe('Alice');
      const runId = randomUUID();
      const result = await analyzeRunRisk({
        id: runId, recipient: 'Successor', departingPerson: 'Alice', projectRoot: dir,
        createdAt: new Date().toISOString(), state: 'awaiting_scope_confirmation', artifacts,
        warnings: [], selectedIds: [], items: [], mode: null, revision: 0,
        approvedRevision: null, acceptedPartial: false,
      }, {});
      expect(result).toEqual({ runId, analysis });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it('rejects with error when empty emails array is supplied', async () => {
    await expect(
      analyzeRepositoryRisk({
        repoPath: process.cwd(),
        emails: [],
      })
    ).rejects.toThrow('At least one author email is required');
  });
});
