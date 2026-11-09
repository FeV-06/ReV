import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { DaemonClient } from '../editors/vscode/src/daemonClient';

const root = process.cwd();

describe('VS Code extension end-to-end integration with live daemon', () => {
  let dataDir = '';
  let workspaceDir = '';
  let daemon: ChildProcess | undefined;
  let client: DaemonClient;
  let initialCommitSha = '';

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'rev-vscode-e2e-data-'));
    workspaceDir = await mkdtemp(path.join(tmpdir(), 'rev-vscode-e2e-ws-'));

    // 1. Initialize Git repository with realistic project files
    execFileSync('git', ['init', '-q', workspaceDir]);
    await writeFile(path.join(workspaceDir, 'package.json'), JSON.stringify({ name: 'sample-service', version: '1.0.0' }, null, 2));
    await writeFile(path.join(workspaceDir, 'index.ts'), 'export const port = 8080;\n');
    execFileSync('git', ['-C', workspaceDir, 'add', '.']);
    execFileSync('git', ['-C', workspaceDir, '-c', 'user.name=FeV-06', '-c', 'user.email=fev@example.invalid', 'commit', '-qm', 'feat: initial service setup']);
    initialCommitSha = execFileSync('git', ['-C', workspaceDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    // 2. Introduce saved working-tree modifications and untracked files
    await writeFile(path.join(workspaceDir, 'index.ts'), 'export const port = 9090; // modified port\n');
    await writeFile(path.join(workspaceDir, 'worker.ts'), 'export function runWorker() { return true; }\n');

    // 3. Spawn real background daemon on ephemeral port
    daemon = spawn(process.execPath, [path.join(root, 'dist/daemon/entry.js')], {
      cwd: root,
      env: { ...process.env, REV_DATA_DIR: dataDir, REV_DAEMON_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Daemon failed to start: ${output}`)), 15_000);
      daemon!.stdout!.on('data', (c: Buffer) => {
        output += c.toString();
        if (output.includes('REV_DAEMON_READY')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      daemon!.stderr!.on('data', (c: Buffer) => (output += c.toString()));
      daemon!.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Daemon exited with code ${code}: ${output}`));
      });
    });

    client = new DaemonClient(dataDir);
  }, 30_000);

  afterAll(async () => {
    if (daemon && daemon.exitCode === null) {
      const tokenPath = path.join(dataDir, 'daemon.token');
      try {
        const token = (await readFile(tokenPath, 'utf8')).trim();
        const state = JSON.parse(await readFile(path.join(dataDir, 'daemon.json'), 'utf8'));
        await fetch(`http://127.0.0.1:${state.port}/v1/shutdown`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        });
      } catch {
        daemon.kill('SIGTERM');
      }
    }
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  }, 20_000);

  it('verifies daemon connectivity and health probe', async () => {
    const health = await client.getHealth(workspaceDir);
    expect(health.status).toBe('ok');
    expect(health.protocol).toBe(1);
    expect(health.port).toBeGreaterThan(0);
  });

  it('registers the open workspace and detects committed and uncommitted changes', async () => {
    // Register workspace with contributor username FeV-06
    const project = await client.registerProject(workspaceDir, 'FeV-06', workspaceDir);
    expect(project.id).toBeDefined();
    expect(project.githubUsername).toBe('FeV-06');
    expect(project.root).toBe(workspaceDir);

    // Trigger scan via extension client
    const snapshot = await client.scanProject(project.id, workspaceDir);
    expect(snapshot.baseline).toBe(true);
    expect(snapshot.commitId).toBe(initialCommitSha);

    // Snapshot changes array must capture both modified index.ts and untracked worker.ts
    const changes = (snapshot as any).changes as Array<{ path: string; indexStatus: string; worktreeStatus: string }>;
    expect(changes).toBeDefined();
    expect(changes.length).toBe(2);

    const indexPath = changes.find((c) => c.path === 'index.ts');
    expect(indexPath).toBeDefined();
    expect(indexPath?.worktreeStatus).toBe('M');

    const workerPath = changes.find((c) => c.path === 'worker.ts');
    expect(workerPath).toBeDefined();
    expect(workerPath?.worktreeStatus).toBe('?');
  });

  it('executes full handover workflow, human review, approval, and workspace export', async () => {
    // 1. Create run with contributor identity and target role
    const run = await client.createRun(
      {
        recipient: 'Senior Successor',
        githubUsername: 'FeV-06',
        targetRole: 'Full-stack engineer',
        fixture: true,
      },
      workspaceDir
    );
    expect(run.id).toBeDefined();
    expect(run.githubUsername).toBe('FeV-06');
    expect(run.targetRole).toBe('Full-stack engineer');
    expect(run.state).toBe('awaiting_scope_confirmation');

    // 2. Scope confirmation
    const selectedIds = run.artifacts.map((a: any) => a.id);
    await client.updateRunAction(run.id, { action: 'scope', selectedIds }, workspaceDir);

    // 3. Generate handover claims
    const generated = await client.updateRunAction(
      run.id,
      {
        action: 'generate',
        selectedIds,
        acceptPartial: true,
        confirmAuthorisation: true,
        fixture: true,
      },
      workspaceDir
    );
    expect(generated.items.length).toBeGreaterThan(0);
    expect(generated.state).toBe('needs_review');

    // 4. Edit an item (human review: edit claim, which invalidates approval and marks claim unverified)
    const modifiedItems = generated.items.map((it: any, idx: number) => {
      if (idx === 0) {
        return { ...it, text: 'Custom edited claim: verified database connection pooling and failover' };
      }
      return it;
    });
    const edited = await client.updateRunAction(
      run.id,
      {
        action: 'save',
        items: modifiedItems,
      },
      workspaceDir
    );
    const updatedItem = edited.items[0];
    expect(updatedItem.text).toBe('Custom edited claim: verified database connection pooling and failover');
    expect(updatedItem.verification).toBe('unverified');

    // 5. Attempt export before approval must fail
    await expect(client.exportMarkdown(run.id, workspaceDir)).rejects.toThrow();

    // 6. Explicitly approve the revision
    const approved = await client.updateRunAction(
      run.id,
      {
        action: 'approve',
        confirmAuthorisation: true,
      },
      workspaceDir
    );
    expect(approved.state).toBe('approved');

    // 7. Export approved markdown
    const markdown = await client.exportMarkdown(run.id, workspaceDir);
    expect(markdown).toContain('# Handover for Senior Successor');
    expect(markdown).toContain('Full\\-stack engineer');
    expect(markdown).toContain('Custom edited claim: verified database connection pooling and failover');
    expect(markdown).toContain('Status: unverified');

    // 8. Write directly to workspace root as HANDOVER.md
    const handoverFile = path.join(workspaceDir, 'HANDOVER.md');
    await writeFile(handoverFile, markdown, 'utf8');

    const fileStat = await stat(handoverFile);
    expect(fileStat.isFile()).toBe(true);

    const onDiskContent = await readFile(handoverFile, 'utf8');
    expect(onDiskContent).toBe(markdown);
  });
});
