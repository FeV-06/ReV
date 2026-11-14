import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

// Covers the safe explicit cloud-sync contract end to end:
//  - no consent (missing confirmSync)  => no upload, 403
//  - per-operation explicit consent    => sync reaches a controlled local connection failure
//  - testOnly                          => connection check only, no consent needed
//  - wizard defaults to local storage; UI never stores a standing sync permission
const root = process.cwd();
let dataDir = '';
let daemon: ChildProcess | undefined;
let address = '';
let token = '';

async function start() {
  daemon = spawn(process.execPath, [path.join(root, 'dist/daemon/entry.js')], {
    cwd: root,
    env: { ...process.env, REV_DATA_DIR: dataDir, REV_DAEMON_PORT: '0', SUPABASE_DB_URL: '', DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Daemon did not become ready: ${output}`)), 15_000);
    daemon!.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/REV_DAEMON_READY (\d+)/);
      if (match) { clearTimeout(timeout); address = `http://127.0.0.1:${match[1]}`; resolve(); }
    });
    daemon!.stderr!.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    daemon!.once('exit', code => { clearTimeout(timeout); reject(new Error(`Daemon exited ${code}: ${output}`)); });
  });
  token = (await readFile(path.join(dataDir, 'daemon.token'), 'utf8')).trim();
}

async function stop() {
  if (!daemon || daemon.exitCode !== null) return;
  const child = daemon;
  const controlToken = (await readFile(path.join(dataDir, 'daemon.token'), 'utf8')).trim();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Daemon did not exit')), 10_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    void fetch(`${address}/v1/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${controlToken}` } }).catch(reject);
  });
  daemon = undefined;
}

async function request(route: string, method = 'GET', body?: object, extra: Record<string, string> = {}) {
  return fetch(`${address}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Fails the connection attempt so sync never reaches a real server. */
function bogusConnectionString(): string {
  return `postgresql://127.0.0.1:1/rev_no_such_db_${randomUUID()}`;
}

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'rev-team-sync-'));
  await start();
}, 30_000);
afterAll(async () => {
  await stop();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
}, 20_000);

describe('daemon-owned Supabase sync fails closed (Rule 7)', () => {
  it('permanently disables legacy bulk sync with 403 and never touches the network', async () => {
    let connections = 0;
    const server: Server = createServer(socket => { connections++; socket.destroy(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No local test address');
      const response = await request('/v1/sync/supabase', 'POST', {
        connectionString: `postgresql://127.0.0.1:${address.port}/rev_fixture`,
      });
      expect(response.status).toBe(403);
      const data = await response.json() as { success?: boolean; error?: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Legacy bulk sync is disabled');
      expect(connections).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    // Any consent attempt is equally refused with 403 fail-closed.
    const res1 = await request('/v1/sync/supabase', 'POST', { connectionString: bogusConnectionString(), confirmSync: false });
    expect(res1.status).toBe(403);
    const res2 = await request('/v1/sync/supabase', 'POST', { connectionString: bogusConnectionString(), confirmSync: true });
    expect(res2.status).toBe(403);
  });

  it('fails closed even when testOnly or confirmSync is present', async () => {
    const testOnlyRes = await request('/v1/sync/supabase', 'POST', {
      testOnly: true,
      connectionString: bogusConnectionString(),
    });
    expect(testOnlyRes.status).toBe(403);
    const testData = await testOnlyRes.json() as { success: boolean; error?: string };
    expect(testData.success).toBe(false);
    expect(testData.error).toContain('Legacy bulk sync is disabled');

    const runSyncRes = await request('/v1/sync/supabase', 'POST', {
      runId: randomUUID(),
      connectionString: bogusConnectionString(),
      confirmSync: true,
    });
    expect(runSyncRes.status).toBe(403);
  });
});

describe('wizard storage default and explicit opt-in UI', () => {
  it('defaults the wizard storage picker to local-only, never cloud', async () => {
    const source = await readFile(path.join(root, 'src/components/admin/HandoverWizard.tsx'), 'utf8');
    expect(source).toMatch(/useState<'cloud' \| 'local'>\('local'\)/);
    expect(source).not.toMatch(/useState<'cloud' \| 'local'>\('cloud'\)/);
  });

  it('labels cloud as opt-in, not default, and marks local as the default', async () => {
    const source = await readFile(path.join(root, 'src/components/admin/HandoverWizard.tsx'), 'utf8');
    expect(source).toContain("Sync to Cloud &amp; Supabase {hasSupabaseConfigured ? '(Opt-in)' : ''}");
    expect(source).toContain("Keep on this computer {!hasSupabaseConfigured ? '(Active Mode)' : ' (Default)'}");
    expect(source).not.toContain("Supabase {hasSupabaseConfigured ? '(Default)' : ''}");
  });

  it('sends confirmSync on every cloud-sync request and never persists a standing permission', async () => {
    const wizard = await readFile(path.join(root, 'src/components/admin/HandoverWizard.tsx'), 'utf8');
    const settings = await readFile(path.join(root, 'src/components/settings/SettingsView.tsx'), 'utf8');
    // Per-run publish and bulk settings sync both carry the one-shot consent literal.
    expect(wizard).toContain('JSON.stringify({ runId: run.id, connectionString, confirmSync: true })');
    expect(wizard).toContain("if (uploadToCloud) setSyncTarget('local')");
    expect(settings).toContain('window.confirm(');
    expect(settings).toMatch(/connectionString: postgresUri\.trim\(\) \|\| undefined,\s*\/\/ Bulk upload of every local run happens only on this explicit,\s*\/\/ user-initiated action; no standing permission is stored\.\s*confirmSync: true,/);
    // The persisted settings payload must not contain a sync-permission flag.
    const saved = settings.match(/const settings = \{[\s\S]*?\};/)?.[0] ?? '';
    expect(saved).not.toContain('confirmSync');
  });

  it('keeps the sync route a pure proxy that never opens PGlite in the Next process', async () => {
    const route = await readFile(path.join(root, 'src/app/api/sync/supabase/route.ts'), 'utf8');
    expect(route).not.toMatch(/syncToSupabase|testPostgresConnection|@\/lib\/server\/store/);
    expect(route).toContain("Legacy bulk sync is disabled");
    expect(route).toContain('assertLocalRequest(request)');
  });

  it('enforces the fail-closed disabled state inside the daemon endpoint', async () => {
    const entry = await readFile(path.join(root, 'src/daemon/entry.ts'), 'utf8');
    expect(entry).toContain("'/v1/sync/supabase'");
    expect(entry).toContain("Legacy bulk sync is disabled: it cannot enforce per-user team permissions.");
  });
});
