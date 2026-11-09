import { mkdir, readFile, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ServiceConfig {
  nodePath: string;
  entryScriptPath: string;
  workingDirectory: string;
  dataDir: string;
  description?: string;
}

export interface AutostartOptions {
  platform?: 'linux' | 'win32';
  targetPath?: string;
  config?: Partial<ServiceConfig>;
  dryRun?: boolean;
  enable?: boolean;
}

export interface AutostartResult {
  success: boolean;
  platform: 'linux' | 'win32';
  targetPath: string;
  content: string;
  commands: string[];
  message: string;
}

export interface AutostartStatus {
  platform: 'linux' | 'win32';
  installed: boolean;
  targetPath: string;
  enabled?: boolean;
  active?: boolean;
  details?: string;
}

export function getLinuxServicePath(customHome?: string): string {
  const home = customHome || homedir();
  return path.join(home, '.config', 'systemd', 'user', 'rev-daemon.service');
}

export function getWindowsStartupPath(customAppData?: string): string {
  const appData = customAppData || process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'rev-daemon.vbs');
}

export function resolveServiceConfig(custom?: Partial<ServiceConfig>): ServiceConfig {
  const workingDirectory = custom?.workingDirectory || process.cwd();
  return {
    nodePath: custom?.nodePath || process.execPath,
    entryScriptPath: custom?.entryScriptPath || path.resolve(workingDirectory, 'dist/daemon/entry.js'),
    workingDirectory,
    dataDir: custom?.dataDir || path.resolve(workingDirectory, '.rev-data'),
    description: custom?.description || 'ReV Continuous Capture & Handover Daemon',
  };
}

export function generateSystemdUnit(config: ServiceConfig): string {
  return `[Unit]
Description=${config.description}
Documentation=https://github.com/FeV-06/ReV
After=network.target

[Service]
Type=simple
WorkingDirectory=${config.workingDirectory}
ExecStart=${config.nodePath} ${config.entryScriptPath}
Restart=on-failure
RestartSec=3s
TimeoutStopSec=15s
KillMode=mixed
Environment=REV_DATA_DIR=${config.dataDir}
Environment=NODE_ENV=production

# User sandbox & resource boundary
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${config.dataDir} ${config.workingDirectory}
NoNewPrivileges=true

[Install]
WantedBy=default.target
`;
}

export function generateWindowsStartupScript(config: ServiceConfig): string {
  const safeWorkDir = config.workingDirectory.replace(/"/g, '""');
  const safeNode = config.nodePath.replace(/"/g, '""');
  const safeScript = config.entryScriptPath.replace(/"/g, '""');
  const safeData = config.dataDir.replace(/"/g, '""');

  return `' ReV Background Daemon Autostart Script (VBScript launcher for silent background execution)
' Generated automatically by ReV
Option Explicit
Dim WshShell, oEnv
Set WshShell = CreateObject("WScript.Shell")
Set oEnv = WshShell.Environment("PROCESS")
oEnv("REV_DATA_DIR") = "${safeData}"
oEnv("NODE_ENV") = "production"
WshShell.CurrentDirectory = "${safeWorkDir}"
WshShell.Run """${safeNode}"" ""${safeScript}""", 0, False
Set WshShell = Nothing
`;
}

export function generateWindowsCmdScript(config: ServiceConfig): string {
  return `@echo off
rem ReV Background Daemon Autostart Script (CMD alternative)
set "REV_DATA_DIR=${config.dataDir}"
set "NODE_ENV=production"
cd /d "${config.workingDirectory}"
start "" /B "${config.nodePath}" "${config.entryScriptPath}"
`;
}

export async function installAutostart(options: AutostartOptions = {}): Promise<AutostartResult> {
  const platform = options.platform || (process.platform === 'win32' ? 'win32' : 'linux');
  const config = resolveServiceConfig(options.config);
  const commands: string[] = [];

  if (platform === 'linux') {
    const targetPath = options.targetPath || getLinuxServicePath();
    const content = generateSystemdUnit(config);

    if (!options.dryRun) {
      await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
      await writeFile(targetPath, content, { encoding: 'utf8', mode: 0o644 });
      await chmod(targetPath, 0o644);

      if (options.enable !== false && !options.targetPath) {
        try {
          await execFileAsync('systemctl', ['--user', 'daemon-reload'], { timeout: 5000 });
          commands.push('systemctl --user daemon-reload');
          await execFileAsync('systemctl', ['--user', 'enable', 'rev-daemon.service'], { timeout: 5000 });
          commands.push('systemctl --user enable rev-daemon.service');
        } catch (err) {
          commands.push('# Note: systemctl execution deferred (run manually in user session)');
        }
      }
    }

    return {
      success: true,
      platform: 'linux',
      targetPath,
      content,
      commands: commands.length > 0 ? commands : [
        `systemctl --user daemon-reload`,
        `systemctl --user enable rev-daemon.service`,
        `systemctl --user start rev-daemon.service`,
      ],
      message: `Systemd user service written to ${targetPath}`,
    };
  }

  if (platform === 'win32') {
    const targetPath = options.targetPath || getWindowsStartupPath();
    const content = generateWindowsStartupScript(config);

    if (!options.dryRun) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, { encoding: 'utf8' });
    }

    return {
      success: true,
      platform: 'win32',
      targetPath,
      content,
      commands: [
        `wscript.exe "${targetPath}"`,
      ],
      message: `Windows user startup script written to ${targetPath}`,
    };
  }

  throw new Error(`Unsupported platform for daemon autostart: ${platform}`);
}

export async function uninstallAutostart(options: AutostartOptions = {}): Promise<AutostartResult> {
  const platform = options.platform || (process.platform === 'win32' ? 'win32' : 'linux');
  const commands: string[] = [];

  if (platform === 'linux') {
    const targetPath = options.targetPath || getLinuxServicePath();

    if (!options.dryRun) {
      if (options.enable !== false && !options.targetPath) {
        try {
          await execFileAsync('systemctl', ['--user', 'stop', 'rev-daemon.service'], { timeout: 5000 });
          commands.push('systemctl --user stop rev-daemon.service');
          await execFileAsync('systemctl', ['--user', 'disable', 'rev-daemon.service'], { timeout: 5000 });
          commands.push('systemctl --user disable rev-daemon.service');
        } catch {}
      }

      await rm(targetPath, { force: true });

      if (options.enable !== false && !options.targetPath) {
        try {
          await execFileAsync('systemctl', ['--user', 'daemon-reload'], { timeout: 5000 });
          commands.push('systemctl --user daemon-reload');
        } catch {}
      }
    }

    return {
      success: true,
      platform: 'linux',
      targetPath,
      content: '',
      commands: commands.length > 0 ? commands : [
        `systemctl --user stop rev-daemon.service`,
        `systemctl --user disable rev-daemon.service`,
        `rm ${targetPath}`,
        `systemctl --user daemon-reload`,
      ],
      message: `Systemd user service removed from ${targetPath}`,
    };
  }

  if (platform === 'win32') {
    const targetPath = options.targetPath || getWindowsStartupPath();

    if (!options.dryRun) {
      await rm(targetPath, { force: true });
    }

    return {
      success: true,
      platform: 'win32',
      targetPath,
      content: '',
      commands: [
        `del "${targetPath}"`,
      ],
      message: `Windows startup script removed from ${targetPath}`,
    };
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

export async function getAutostartStatus(options: AutostartOptions = {}): Promise<AutostartStatus> {
  const platform = options.platform || (process.platform === 'win32' ? 'win32' : 'linux');

  if (platform === 'linux') {
    const targetPath = options.targetPath || getLinuxServicePath();
    let installed = false;
    try {
      const s = await stat(targetPath);
      installed = s.isFile();
    } catch {
      installed = false;
    }

    let enabled: boolean | undefined;
    let active: boolean | undefined;
    let details: string | undefined;

    if (installed && !options.targetPath) {
      try {
        const { stdout: enabledOut } = await execFileAsync('systemctl', ['--user', 'is-enabled', 'rev-daemon.service'], { timeout: 3000 });
        enabled = enabledOut.trim() === 'enabled';
      } catch {
        enabled = false;
      }
      try {
        const { stdout: activeOut } = await execFileAsync('systemctl', ['--user', 'is-active', 'rev-daemon.service'], { timeout: 3000 });
        active = activeOut.trim() === 'active';
      } catch {
        active = false;
      }
    }

    return {
      platform: 'linux',
      installed,
      targetPath,
      enabled,
      active,
      details,
    };
  }

  if (platform === 'win32') {
    const targetPath = options.targetPath || getWindowsStartupPath();
    let installed = false;
    try {
      const s = await stat(targetPath);
      installed = s.isFile();
    } catch {
      installed = false;
    }

    return {
      platform: 'win32',
      installed,
      targetPath,
      enabled: installed,
    };
  }

  throw new Error(`Unsupported platform: ${platform}`);
}
