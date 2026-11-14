import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface DaemonConfig {
  baseUrl: string;
  token?: string;
}

export function resolveDaemonConfig(): DaemonConfig {
  const candidateDirs: string[] = [];
  if (process.env.REV_DATA_DIR) {
    candidateDirs.push(process.env.REV_DATA_DIR);
  }
  candidateDirs.push(join(process.cwd(), '.rev-data'));
  candidateDirs.push(join(homedir(), '.rev-data'));

  let baseUrl = process.env.REV_DAEMON_URL || 'http://127.0.0.1:3078';
  let token = process.env.REV_DAEMON_TOKEN;

  for (const dir of candidateDirs) {
    const metadataPath = join(dir, 'daemon.json');
    const tokenPath = join(dir, 'daemon.token');

    if (!process.env.REV_DAEMON_URL && existsSync(metadataPath)) {
      try {
        const meta = JSON.parse(readFileSync(metadataPath, 'utf8'));
        if (meta.port) {
          baseUrl = `http://127.0.0.1:${meta.port}`;
        }
      } catch {}
    }

    if (!token && existsSync(tokenPath)) {
      try {
        token = readFileSync(tokenPath, 'utf8').trim();
      } catch {}
    }

    if (token && baseUrl) break;
  }

  return { baseUrl, token };
}

export class DaemonApiClient {
  private explicitConfig?: Partial<DaemonConfig>;

  constructor(config?: Partial<DaemonConfig>) {
    this.explicitConfig = config;
  }

  private getConfig(): DaemonConfig {
    const resolved = resolveDaemonConfig();
    return {
      baseUrl: this.explicitConfig?.baseUrl || resolved.baseUrl,
      token: this.explicitConfig?.token || resolved.token,
    };
  }

  async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const config = this.getConfig();
    const url = `${config.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Rev-Request': '1',
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };

    const res = await fetch(url, {
      ...options,
      headers,
    }).catch(async (fetchError) => {
      // If loopback connection failed, re-resolve config in case daemon restarted on a new port
      const freshConfig = resolveDaemonConfig();
      if (freshConfig.baseUrl !== config.baseUrl || freshConfig.token !== config.token) {
        const retryUrl = `${freshConfig.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
        const retryHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Rev-Request': '1',
          ...(freshConfig.token ? { Authorization: `Bearer ${freshConfig.token}` } : {}),
          ...((options.headers as Record<string, string>) || {}),
        };
        return fetch(retryUrl, { ...options, headers: retryHeaders });
      }
      throw fetchError;
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Daemon request failed with status ${res.status}`);
    }
    return data as T;
  }
}
