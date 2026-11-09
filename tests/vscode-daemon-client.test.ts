import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { DaemonClient, normalizePath, pathContains } from '../editors/vscode/src/daemonClient';

describe('DaemonClient error handling and boundary tests', () => {
  it('resolves data directory by priority', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'rev-data-priority-'));
    const wsDir = path.join(tempDir, 'workspace');
    const localData = path.join(wsDir, '.rev-data');
    await mkdir(localData, { recursive: true });
    await writeFile(path.join(localData, 'daemon.json'), JSON.stringify({ port: 1234 }));

    try {
      // 1. Explicit constructor argument wins
      const clientCustom = new DaemonClient('/custom/path');
      expect(await clientCustom.resolveDataDir(wsDir)).toBe(path.resolve('/custom/path'));

      // 2. Local workspace .rev-data takes precedence over global fallback
      const clientAuto = new DaemonClient();
      expect(await clientAuto.resolveDataDir(wsDir)).toBe(localData);

      // 3. Fallback when workspace has no .rev-data
      const emptyWs = path.join(tempDir, 'empty');
      await mkdir(emptyWs, { recursive: true });
      expect(await clientAuto.resolveDataDir(emptyWs)).toContain('.rev-data');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails closed when daemon metadata or token is missing', async () => {
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'rev-empty-data-'));
    const client = new DaemonClient(emptyDir);

    try {
      await expect(client.getConnection()).rejects.toThrow('ReV daemon is not running or unreachable');
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('detects corrupted token and refuses connection', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'rev-corrupt-data-'));
    await writeFile(path.join(dataDir, 'daemon.token'), 'actual-secret-token\n');
    await writeFile(
      path.join(dataDir, 'daemon.json'),
      JSON.stringify({
        protocol: 1,
        port: 9999,
        pid: 12345,
        tokenHash: '0'.repeat(64), // Mismatched fake hash
      })
    );

    const client = new DaemonClient(dataDir);
    try {
      await expect(client.getConnection()).rejects.toThrow('Mismatched daemon token hash; refusing connection.');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('extracts server error messages from HTTP error responses', async () => {
    let server: Server;
    let port = 0;

    await new Promise<void>(resolve => {
      server = createServer((req, res) => {
        if (req.url === '/v1/projects' && req.method === 'POST') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Directory is already registered as an active project' }));
          return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Resource not found' }));
      });
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as any).port;
        resolve();
      });
    });

    const dataDir = await mkdtemp(path.join(tmpdir(), 'rev-http-err-'));
    const token = 'valid-token';
    const { createHash } = await import('node:crypto');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await writeFile(path.join(dataDir, 'daemon.token'), token);
    await writeFile(path.join(dataDir, 'daemon.json'), JSON.stringify({ protocol: 1, port, pid: process.pid, tokenHash }));

    const client = new DaemonClient(dataDir);

    try {
      await expect(client.registerProject('/some/path', 'FeV-06')).rejects.toThrow(
        'Directory is already registered as an active project'
      );
      await expect(client.request('/v1/nonexistent')).rejects.toThrow('Resource not found');
    } finally {
      server!.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

describe('path resolution and containment boundary cases', () => {
  it('handles trailing slashes, relative dots, and case normalization', () => {
    const base = path.resolve('/home/fev/projects/rev');
    const withSlash = `${base}/`;
    const nested = path.join(base, 'src', 'lib');
    const siblingWithSamePrefix = `${base}-extra`;

    expect(normalizePath(base)).toBe(normalizePath(withSlash));
    expect(pathContains(base, withSlash)).toBe(true);
    expect(pathContains(withSlash, base)).toBe(true);
    expect(pathContains(base, nested)).toBe(true);
    expect(pathContains(base, siblingWithSamePrefix)).toBe(false);

    // Traversal attempts must never be treated as contained
    expect(pathContains(base, path.join(base, '..', 'other'))).toBe(false);
  });
});
