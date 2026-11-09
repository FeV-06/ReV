import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  generateSystemdUnit,
  generateWindowsCmdScript,
  generateWindowsStartupScript,
  getAutostartStatus,
  getLinuxServicePath,
  getWindowsStartupPath,
  installAutostart,
  resolveServiceConfig,
  uninstallAutostart,
} from '@/daemon/autostart';

const root = process.cwd();

describe('daemon autostart configuration and generation', () => {
  const config = {
    nodePath: '/usr/bin/node',
    entryScriptPath: '/home/user/app/dist/daemon/entry.js',
    workingDirectory: '/home/user/app',
    dataDir: '/home/user/.rev-data',
    description: 'ReV Daemon Test',
  };

  it('generates a valid Linux systemd user service unit with security sandboxing', () => {
    const unit = generateSystemdUnit(config);

    expect(unit).toContain('[Unit]');
    expect(unit).toContain('Description=ReV Daemon Test');
    expect(unit).toContain('Documentation=https://github.com/FeV-06/ReV');
    expect(unit).toContain('[Service]');
    expect(unit).toContain('WorkingDirectory=/home/user/app');
    expect(unit).toContain('ExecStart=/usr/bin/node /home/user/app/dist/daemon/entry.js');
    expect(unit).toContain('Environment=REV_DATA_DIR=/home/user/.rev-data');
    expect(unit).toContain('Environment=NODE_ENV=production');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('RestartSec=3s');
    expect(unit).toContain('ProtectSystem=strict');
    expect(unit).toContain('ProtectHome=read-only');
    expect(unit).toContain('ReadWritePaths=/home/user/.rev-data /home/user/app');
    expect(unit).toContain('NoNewPrivileges=true');
    expect(unit).toContain('[Install]');
    expect(unit).toContain('WantedBy=default.target');
  });

  it('generates Windows silent VBScript and CMD autostart scripts', () => {
    const vbs = generateWindowsStartupScript(config);
    expect(vbs).toContain('Option Explicit');
    expect(vbs).toContain('WScript.Shell');
    expect(vbs).toContain('REV_DATA_DIR');
    expect(vbs).toContain('/home/user/.rev-data');
    expect(vbs).toContain('WshShell.Run');
    expect(vbs).toContain(', 0, False');

    const cmd = generateWindowsCmdScript(config);
    expect(cmd).toContain('@echo off');
    expect(cmd).toContain('set "REV_DATA_DIR=/home/user/.rev-data"');
    expect(cmd).toContain('start "" /B');
  });

  it('resolves correct default Linux and Windows paths', () => {
    const linuxPath = getLinuxServicePath('/custom/home');
    expect(linuxPath).toBe('/custom/home/.config/systemd/user/rev-daemon.service');

    const winPath = getWindowsStartupPath('C:\\Users\\Test\\AppData\\Roaming');
    expect(winPath).toBe(
      path.join('C:\\Users\\Test\\AppData\\Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'rev-daemon.vbs')
    );
  });
});

describe('isolated install, status, and uninstall lifecycle', () => {
  it('manages Linux autostart lifecycle in an isolated target path', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'rev-autostart-linux-'));
    const targetPath = path.join(tempDir, 'systemd', 'user', 'rev-daemon.service');

    try {
      let status = await getAutostartStatus({ platform: 'linux', targetPath });
      expect(status.installed).toBe(false);

      const installResult = await installAutostart({
        platform: 'linux',
        targetPath,
        dryRun: false,
        enable: false,
        config: {
          nodePath: process.execPath,
          entryScriptPath: path.resolve('dist/daemon/entry.js'),
          workingDirectory: process.cwd(),
          dataDir: path.resolve('.rev-data'),
        },
      });

      expect(installResult.success).toBe(true);
      expect(installResult.targetPath).toBe(targetPath);

      const fileStats = await stat(targetPath);
      expect(fileStats.isFile()).toBe(true);
      if (process.platform !== 'win32') {
        expect(fileStats.mode & 0o777).toBe(0o644);
      }

      const fileContent = await readFile(targetPath, 'utf8');
      expect(fileContent).toContain('Description=ReV Continuous Capture & Handover Daemon');
      expect(fileContent).toContain(process.execPath);

      status = await getAutostartStatus({ platform: 'linux', targetPath });
      expect(status.installed).toBe(true);

      const uninstallResult = await uninstallAutostart({
        platform: 'linux',
        targetPath,
        dryRun: false,
        enable: false,
      });

      expect(uninstallResult.success).toBe(true);
      status = await getAutostartStatus({ platform: 'linux', targetPath });
      expect(status.installed).toBe(false);

      // Idempotent uninstall does not fail if file is already deleted
      await expect(uninstallAutostart({ platform: 'linux', targetPath, dryRun: false, enable: false })).resolves.not.toThrow();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('manages Windows autostart lifecycle in an isolated target path', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'rev-autostart-win-'));
    const targetPath = path.join(tempDir, 'Startup', 'rev-daemon.vbs');

    try {
      let status = await getAutostartStatus({ platform: 'win32', targetPath });
      expect(status.installed).toBe(false);

      const installResult = await installAutostart({
        platform: 'win32',
        targetPath,
        dryRun: false,
        enable: false,
      });

      expect(installResult.success).toBe(true);
      expect(installResult.targetPath).toBe(targetPath);

      const fileStats = await stat(targetPath);
      expect(fileStats.isFile()).toBe(true);

      const fileContent = await readFile(targetPath, 'utf8');
      expect(fileContent).toContain('Option Explicit');
      expect(fileContent).toContain('WScript.Shell');

      status = await getAutostartStatus({ platform: 'win32', targetPath });
      expect(status.installed).toBe(true);

      const uninstallResult = await uninstallAutostart({
        platform: 'win32',
        targetPath,
        dryRun: false,
        enable: false,
      });

      expect(uninstallResult.success).toBe(true);
      status = await getAutostartStatus({ platform: 'win32', targetPath });
      expect(status.installed).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('supports dry-run mode without modifying filesystem', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'rev-autostart-dry-'));
    const targetPath = path.join(tempDir, 'rev-daemon.service');

    try {
      const result = await installAutostart({
        platform: 'linux',
        targetPath,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('[Unit]');
      await expect(stat(targetPath)).rejects.toThrow();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('daemon crash and stale lock recovery', () => {
  it('automatically cleans up stale lock file from dead PID upon startup', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'rev-stale-lock-test-'));
    const lockPath = path.join(dataDir, 'daemon.lock');
    const lockOwnerPath = path.join(lockPath, 'owner.json');

    // Create an artificial stale lock directory with a dead PID (e.g. 9999999)
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    const deadPid = 9999999;
    await writeFile(
      lockOwnerPath,
      JSON.stringify({ protocol: 1, pid: deadPid, nonce: 'deaddeaddeaddead' }) + '\n',
      { mode: 0o600 }
    );

    // Verify lock exists before starting daemon
    expect((await stat(lockOwnerPath)).isFile()).toBe(true);

    // Now start the daemon with this dataDir. It should clean up the stale lock and start successfully!
    const daemon: ChildProcess = spawn(process.execPath, [path.join(root, 'dist/daemon/entry.js')], {
      cwd: root,
      env: { ...process.env, REV_DATA_DIR: dataDir, REV_DAEMON_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let address = '';
    let output = '';

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Daemon failed to start: ${output}`)), 15_000);
        daemon.stdout!.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          const match = output.match(/REV_DAEMON_READY (\d+)/);
          if (match) {
            clearTimeout(timeout);
            address = `http://127.0.0.1:${match[1]}`;
            resolve();
          }
        });
        daemon.stderr!.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        daemon.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`Daemon exited ${code}: ${output}`));
        });
      });

      expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      // Verify the new owner is the current daemon process, not the dead PID
      const newOwner = JSON.parse(await readFile(lockOwnerPath, 'utf8'));
      expect(newOwner.pid).toBe(daemon.pid);
      expect(newOwner.pid).not.toBe(deadPid);

      // Health check should respond with 401 unauthenticated
      const healthResp = await fetch(`${address}/v1/health`);
      expect(healthResp.status).toBe(401);
    } finally {
      const tokenPath = path.join(dataDir, 'daemon.token');
      try {
        const controlToken = (await readFile(tokenPath, 'utf8')).trim();
        await fetch(`${address}/v1/shutdown`, {
          method: 'POST',
          headers: { authorization: `Bearer ${controlToken}` },
        });
      } catch {
        daemon.kill('SIGTERM');
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
