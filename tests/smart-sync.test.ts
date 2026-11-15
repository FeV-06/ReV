import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { closeDatabase, database } from '@/lib/server/store';
import {
  ANALYZER_VERSION,
  analysisFromCache,
  ensureTeamTables,
  projectIdentity,
  smartAnalyzeCommit,
  type CachedAnalysis,
} from '@/lib/server/team-local';

const dbDir = path.join(tmpdir(), `rev-smart-sync-test-${process.pid}`);
process.env.REV_DATA_DIR = dbDir;

let root = '';

function runGit(args: string[]) {
  execFileSync('git', ['-C', root, ...args], {
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_AUTHOR_NAME: 'Test User',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test User',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
}

function gitHead(): string {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rev-smart-git-'));
  runGit(['init', '-q']);
  runGit(['remote', 'add', 'origin', 'https://github.com/example/smart-sync-repo.git']);
  await ensureTeamTables();
});

afterAll(async () => {
  await closeDatabase();
  await rm(dbDir, { recursive: true, force: true });
});

describe('Smart incremental AST sync', () => {
  it('analyzes base commit, then incrementally layers subsequent commits using range diffing', async () => {
    // 1. Create initial commit with module A
    const fileA = path.join(root, 'moduleA.ts');
    await writeFile(fileA, 'export function computeInitial(): number { return 42; }\n');
    runGit(['add', 'moduleA.ts']);
    runGit(['commit', '-q', '-m', 'initial commit']);
    const commit1 = gitHead();

    const { projectKey } = await projectIdentity(root);

    // Initial analysis for commit 1
    const report1 = await smartAnalyzeCommit(root, commit1);
    expect(report1.commitSha).toBe(commit1);
    expect(report1.files).toHaveLength(1);
    expect(report1.files[0].filePath).toBe('moduleA.ts');
    expect(report1.files[0].changedSymbols.some(s => s.symbol.name === 'computeInitial')).toBe(true);

    // Verify it is cached
    const cached1 = await analysisFromCache(projectKey, commit1);
    expect(cached1).toBeDefined();
    expect(cached1?.commitSha).toBe(commit1);

    // 2. Add second commit modifying module A and adding module B
    const fileB = path.join(root, 'moduleB.ts');
    await writeFile(fileA, 'export function computeInitial(): number { return 100; }\nexport function helper(): void {}\n');
    await writeFile(fileB, 'export class DataService { run() {} }\n');
    runGit(['add', 'moduleA.ts', 'moduleB.ts']);
    runGit(['commit', '-q', '-m', 'add module B and update module A']);
    const commit2 = gitHead();

    // 3. Smart analyze commit 2: should chain from commit 1
    const report2 = await smartAnalyzeCommit(root, commit2);
    expect(report2.commitSha).toBe(commit2);

    const filePaths = report2.files.map(f => f.filePath);
    expect(filePaths).toContain('moduleA.ts');
    expect(filePaths).toContain('moduleB.ts');

    // Verify team_analysis_cache has commit 2 with baseCommit pointing to commit 1
    const db = await database();
    const row = await db.query<{ payload: CachedAnalysis }>(
      'SELECT payload FROM team_analysis_cache WHERE project_key=$1 AND commit_id=$2',
      [projectKey, commit2]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].payload.commit).toBe(commit2);
    expect(row.rows[0].payload.baseCommit).toBe(commit1);

    // 4. Add third commit adding module C without touching module A
    const fileC = path.join(root, 'moduleC.ts');
    await writeFile(fileC, 'export function renderChart(): void {}\n');
    runGit(['add', 'moduleC.ts']);
    runGit(['commit', '-q', '-m', 'add module C']);
    const commit3 = gitHead();

    const report3 = await smartAnalyzeCommit(root, commit3);
    expect(report3.commitSha).toBe(commit3);
    const filePaths3 = report3.files.map((f: { filePath: string }) => f.filePath);
    expect(filePaths3).toContain('moduleA.ts');
    expect(filePaths3).toContain('moduleB.ts');
    expect(filePaths3).toContain('moduleC.ts');

    const row3 = await db.query<{ payload: CachedAnalysis }>(
      'SELECT payload FROM team_analysis_cache WHERE project_key=$1 AND commit_id=$2',
      [projectKey, commit3]
    );
    expect(row3.rows[0].payload.commit).toBe(commit3);
    expect(row3.rows[0].payload.baseCommit).toBe(commit2);

    // Clean up repo temp dir
    await rm(root, { recursive: true, force: true });
  });
});
