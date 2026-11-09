import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { DaemonClient, normalizePath, pathContains } from '../editors/vscode/src/daemonClient';
import { generateWebviewHtml, getNonce, type WebviewState } from '../editors/vscode/src/webviewPanel';

const root = process.cwd();
const extensionRoot = path.join(root, 'editors/vscode');

describe('VS Code extension manifest and packaging sanity', () => {
  it('has valid manifest with required commands and activation events', async () => {
    const pkgJsonPath = path.join(extensionRoot, 'package.json');
    const pkg = JSON.parse(await readFile(pkgJsonPath, 'utf8'));

    expect(pkg.name).toBe('rev-vscode');
    expect(pkg.publisher).toBe('fev');
    expect(pkg.main).toBe('./dist/extension.cjs');
    expect(pkg.activationEvents).toContain('onStartupFinished');

    const commands = pkg.contributes.commands.map((c: any) => c.command);
    expect(commands).toContain('rev.openHandover');
    expect(commands).toContain('rev.registerWorkspace');
    expect(commands).toContain('rev.syncCapture');
    expect(commands).toContain('rev.daemonStatus');
    expect(commands).toContain('rev.openDashboard');

    expect(pkg.contributes.viewsContainers.activitybar[0].id).toBe('rev-sidebar');
    expect(pkg.contributes.views['rev-sidebar'][0].id).toBe('rev.sidebarView');
  });

  it('has compiled extension bundle under 200KB', async () => {
    const bundlePath = path.join(extensionRoot, 'dist/extension.cjs');
    const s = await stat(bundlePath);
    expect(s.isFile()).toBe(true);
    // Lean bundle check (<200KB)
    expect(s.size).toBeLessThan(200 * 1024);
  });

  it('has strict .vscodeignore excluding source files and tests', async () => {
    const ignorePath = path.join(extensionRoot, '.vscodeignore');
    const content = await readFile(ignorePath, 'utf8');
    expect(content).toContain('src/**');
    expect(content).toContain('node_modules/**');
  });
});

describe('path resolution and containment logic', () => {
  it('correctly canonicalizes paths and detects containment', () => {
    const parent = path.resolve('/home/fev/projects/app');
    const child = path.resolve('/home/fev/projects/app/src/lib');
    const sibling = path.resolve('/home/fev/projects/other');

    expect(normalizePath(parent)).toBe(path.normalize(parent).toLowerCase() === parent.toLowerCase() && process.platform === 'win32' ? parent.toLowerCase() : parent);
    expect(pathContains(parent, child)).toBe(true);
    expect(pathContains(parent, parent)).toBe(true);
    expect(pathContains(parent, sibling)).toBe(false);
  });
});

describe('webview template security and theme integration', () => {
  it('generates nonce-guarded CSP and escapes untrusted strings', () => {
    const mockWebview: any = {
      cspSource: 'vscode-webview:',
    };

    const state: WebviewState = {
      daemonStatus: 'connected',
      daemonPort: 3078,
      workspacePath: '/home/fev/workspace/test',
      error: '<script>alert("xss")</script>',
      project: {
        id: 'proj-123',
        root: '/home/fev/workspace/test',
        githubUsername: 'FeV-06',
        gitCommonDir: '/home/fev/workspace/test/.git',
        createdAt: new Date().toISOString(),
        paused: false,
        captureStatus: 'active',
      },
    };

    const html = generateWebviewHtml(mockWebview, state);

    expect(html).toContain("default-src 'none'");
    expect(html).toContain('nonce-');
    expect(html).toContain('style-src vscode-webview: \'unsafe-inline\'');
    // Ensure XSS attempt is escaped in script tag
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('\\u003cscript>alert');
    // Check VS Code theme variable usage
    expect(html).toContain('var(--vscode-editor-background');
    expect(html).toContain('var(--vscode-button-background');
  });

  it('generates random unique nonces', () => {
    const n1 = getNonce();
    const n2 = getNonce();
    expect(n1.length).toBe(32);
    expect(n2.length).toBe(32);
    expect(n1).not.toBe(n2);
  });
});

describe('extension daemon client integration against live daemon', () => {
  let dataDir = '';
  let daemon: ChildProcess | undefined;
  let client: DaemonClient;
  let testWorkspace = '';

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'rev-vscode-test-data-'));
    testWorkspace = await mkdtemp(path.join(tmpdir(), 'rev-vscode-ws-'));

    // Initialize git repository in testWorkspace
    execFileSync('git', ['init', '-q', testWorkspace]);
    const readme = path.join(testWorkspace, 'README.md');
    await writeFile(readme, '# Test App\n');
    execFileSync('git', ['-C', testWorkspace, 'add', '.']);
    execFileSync('git', ['-C', testWorkspace, '-c', 'user.name=FeV', '-c', 'user.email=fev@example.invalid', 'commit', '-qm', 'initial commit']);

    // Spawn real daemon with ephemeral port
    daemon = spawn(process.execPath, [path.join(root, 'dist/daemon/entry.js')], {
      cwd: root,
      env: { ...process.env, REV_DATA_DIR: dataDir, REV_DAEMON_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Daemon timed out: ${output}`)), 15_000);
      daemon!.stdout!.on('data', (c: Buffer) => {
        output += c.toString();
        if (output.includes('REV_DAEMON_READY')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      daemon!.stderr!.on('data', (c: Buffer) => output += c.toString());
      daemon!.once('exit', code => {
        clearTimeout(timeout);
        reject(new Error(`Daemon exited early with code ${code}: ${output}`));
      });
    });

    client = new DaemonClient(dataDir);
  }, 25_000);

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
    if (testWorkspace) await rm(testWorkspace, { recursive: true, force: true });
  }, 20_000);

  it('checks daemon health and confirms protocol version', async () => {
    const health = await client.getHealth();
    expect(health.status).toBe('ok');
    expect(health.protocol).toBe(1);
    expect(health.port).toBeGreaterThan(0);
  });

  it('manages workspace project registration, scoping, and handover export', async () => {
    // 1. Initially no project matches testWorkspace
    let match = await client.findProjectByRoot(testWorkspace);
    expect(match).toBeUndefined();

    // 2. Register workspace with contributor username FeV-06
    const project = await client.registerProject(testWorkspace, 'FeV-06');
    expect(project.id).toBeDefined();
    expect(project.githubUsername).toBe('FeV-06');

    // 3. Project is now found by workspace root
    match = await client.findProjectByRoot(testWorkspace);
    expect(match).toBeDefined();
    expect(match!.id).toBe(project.id);

    // 4. Trigger scan
    const snapshot = await client.scanProject(project.id);
    expect(snapshot.baseline).toBe(true);
    expect(snapshot.commitId).toBeDefined();
    expect(Array.isArray((snapshot as any).changes)).toBe(true);

    // 5. Create synthetic handover run
    const run = await client.createRun({
      recipient: 'Incoming Engineer',
      githubUsername: 'FeV-06',
      targetRole: 'Backend engineer',
      fixture: true,
    });
    expect(run.id).toBeDefined();
    expect(run.artifacts.length).toBeGreaterThan(0);

    // 6. Scope and generate claims
    const selectedIds = run.artifacts.map((a: any) => a.id);
    await client.updateRunAction(run.id, {
      action: 'scope',
      selectedIds,
    });
    const generated = await client.updateRunAction(run.id, {
      action: 'generate',
      selectedIds,
      acceptPartial: true,
      confirmAuthorisation: true,
      fixture: true,
    });
    expect(generated.items.length).toBeGreaterThan(0);

    // 7. Approve revision
    const approved = await client.updateRunAction(run.id, {
      action: 'approve',
      confirmAuthorisation: true,
    });
    expect(approved.state).toBe('approved');

    // 8. Export markdown handover
    const markdown = await client.exportMarkdown(run.id);
    expect(markdown).toContain('# Handover for Incoming Engineer');
    expect(markdown).toContain('Target role: Backend engineer');
    expect(markdown).toContain('Contributor: FeV');
  });
});
