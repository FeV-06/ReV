import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { closeDatabase } from '@/lib/server/store';
import { registerProject, removeProject, setProjectPaused, getProject } from '@/lib/server/projects';
import { scanProject, readLatestSnapshot } from '@/lib/server/capture';
import { connectedSources, importLocalGit } from '@/lib/server/sources';
import { suggestedAreas } from '@/lib/handover';
import type { Artifact, Run } from '@/lib/contracts';
import { spawn } from 'node:child_process';

const BLINKY_PATH = '/home/fev/.hermes/cache/scratch/test-blinky';
const BLINKY_REPO = 'KingSahil/Blinky';
const BLINKY_USER = 'FeV-06';

process.env.REV_DATA_DIR = path.join(tmpdir(), `rev-blinky-live-${process.pid}`);

async function callCore(op: object): Promise<unknown> {
  const corePath = path.resolve('target/debug/rev-core');
  let token = process.env.REV_GITHUB_TOKEN;
  if (!token) {
    try { token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim(); }
    catch {}
  }
  const env = { ...process.env };
  if (token) env.REV_GITHUB_TOKEN = token;
  return new Promise((resolve, reject) => {
    const child = spawn(corePath, [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', code => {
      if (code !== 0) return reject(new Error(stderr || `rev-core exited with ${code}`));
      try {
        const parsed = JSON.parse(stdout);
        if (!parsed.ok) return reject(new Error(parsed.error || 'rev-core failure'));
        resolve(parsed.data);
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(JSON.stringify(op));
  });
}

describe('High-quality verification against KingSahil/Blinky and FeV-06', () => {
  let hasLocalBlinky = false;
  let initialHead = '';

  beforeAll(async () => {
    try {
      await stat(path.join(BLINKY_PATH, '.git'));
      initialHead = execFileSync('git', ['-C', BLINKY_PATH, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      hasLocalBlinky = true;
    } catch {
      hasLocalBlinky = false;
    }
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('verifies on-demand local Git ingestion and author parsing for Blinky', async () => {
    if (!hasLocalBlinky) return;
    const oldGitDir = process.env.REV_GIT_DIR;
    process.env.REV_GIT_DIR = BLINKY_PATH;
    try {
      const sources = await connectedSources();
      expect(sources.localGit).toBe('test-blinky');
      expect(sources.gitAuthors.length).toBeGreaterThan(0);
      const hasFev = sources.gitAuthors.some((a: string) => a.toLowerCase().includes('fev'));
      expect(hasFev).toBe(true);

      const imported = await importLocalGit();
      expect(imported.artifacts.length).toBeGreaterThan(0);
      const fevArtifacts = imported.artifacts.filter((a: Artifact) => Boolean(a.author && a.author.toLowerCase().includes('fev')));
      expect(fevArtifacts.length).toBeGreaterThan(0);

      // Verify path metadata exists on commits
      const withPaths = fevArtifacts.filter((a: Artifact) => Boolean(a.paths && a.paths.length > 0));
      expect(withPaths.length).toBeGreaterThan(0);

      // Verify suggested areas can be derived from FeV's commits
      const fakeRun: Run = {
        id: '00000000-0000-0000-0000-000000000001',
        recipient: 'Successor',
        departingPerson: fevArtifacts[0].author ?? undefined,
        createdAt: new Date().toISOString(),
        state: 'awaiting_scope_confirmation',
        artifacts: imported.artifacts,
        warnings: [],
        selectedIds: [],
        items: [],
        mode: null,
        revision: 0,
        approvedRevision: null,
        acceptedPartial: false,
      };
      const areas = suggestedAreas(fakeRun);
      expect(areas.length).toBeGreaterThan(0);
    } finally {
      if (oldGitDir !== undefined) process.env.REV_GIT_DIR = oldGitDir;
      else delete process.env.REV_GIT_DIR;
    }
  });

  it('verifies registration and incremental metadata capture on Blinky without mutating repository state', async () => {
    if (!hasLocalBlinky) return;
    let projectId = '';
    try {
      const project = await registerProject({
        root: BLINKY_PATH,
        githubUsername: BLINKY_USER,
        confirmWatch: true,
      });
      projectId = project.id;
      expect(project.githubUsername).toBe(BLINKY_USER);
      expect(project.root).toBe(BLINKY_PATH);

      // 1. Initial baseline scan
      const baseline = await scanProject(projectId);
      expect(baseline.baseline).toBe(true);
      expect(baseline.commitId).toBe(initialHead);
      expect(baseline.changes).toEqual([]);

      // 2. Uncommitted change detection (scratch file)
      const testFile = path.join(BLINKY_PATH, 'temp-rev-verification-probe.txt');
      await writeFile(testFile, 'probe content for incremental capture\n');
      try {
        const dirtyScan = await scanProject(projectId);
        expect(dirtyScan.baseline).toBe(false);
        const changedPaths = dirtyScan.changes.map((c: { path: string }) => c.path);
        expect(changedPaths).toContain('temp-rev-verification-probe.txt');

        // Confirm snapshot was persisted
        const latest = await readLatestSnapshot(projectId);
        expect(latest?.id).toBe(dirtyScan.id);
      } finally {
        await rm(testFile, { force: true });
      }

      // 3. Clean working tree re-scan
      const cleanScan = await scanProject(projectId);
      expect(cleanScan.changes.map((c: { path: string }) => c.path)).not.toContain('temp-rev-verification-probe.txt');

      // 4. Resume / Pause state transitions
      const resumed = await setProjectPaused(projectId, false);
      expect(resumed.paused).toBe(false);
      expect(resumed.captureStatus).toBe('active');

      const rePaused = await setProjectPaused(projectId, true);
      expect(rePaused.paused).toBe(true);
      expect(rePaused.captureStatus).toBe('not_implemented');

      // 5. Verify Git repository HEAD was completely untouched
      const currentHead = execFileSync('git', ['-C', BLINKY_PATH, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      expect(currentHead).toBe(initialHead);
    } finally {
      if (projectId) await removeProject(projectId);
    }
  });

  it('verifies live remote GitHub ingestion and contributor attribution for KingSahil/Blinky + FeV-06', async () => {
    const rawResult = await callCore({
      op: 'github',
      repo: BLINKY_REPO,
      contributor: BLINKY_USER,
    }) as { artifacts: Array<{ kind: string; githubLogin?: string; author: string | null; text: string; sourceRef: string }>; warnings: string[] };

    expect(rawResult.artifacts.length).toBeGreaterThan(0);

    // Filter commits and PRs matching contributor FeV-06
    const matchingCommits = rawResult.artifacts.filter(
      a => a.kind === 'github_commit' && a.githubLogin?.toLowerCase() === BLINKY_USER.toLowerCase()
    );
    expect(matchingCommits.length).toBeGreaterThan(0);

    // Verify commit metadata structure
    const sample = matchingCommits[0];
    expect(sample.githubLogin?.toLowerCase()).toBe(BLINKY_USER.toLowerCase());
    expect(sample.sourceRef).toContain(BLINKY_REPO);
    expect(sample.text.length).toBeGreaterThan(0);

    // Verify pull requests are included in ingestion
    const prs = rawResult.artifacts.filter(a => a.kind === 'github_pr');
    expect(prs.length).toBeGreaterThan(0);
  }, 45_000);
});
