import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface DaemonConfig {
  baseUrl: string;
  token?: string;
}

export function resolveDaemonConfig(): DaemonConfig {
  const dataDir = process.env.REV_DATA_DIR || join(homedir(), '.rev-data');
  const metadataPath = join(dataDir, 'daemon.json');
  const tokenPath = join(dataDir, 'daemon.token');

  let baseUrl = process.env.REV_DAEMON_URL || 'http://127.0.0.1:3078';
  let token = process.env.REV_DAEMON_TOKEN;

  if (existsSync(metadataPath)) {
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

  return { baseUrl, token };
}

export class DaemonApiClient {
  private config: DaemonConfig;

  constructor(config?: Partial<DaemonConfig>) {
    const resolved = resolveDaemonConfig();
    this.config = {
      baseUrl: config?.baseUrl || resolved.baseUrl,
      token: config?.token || resolved.token,
    };
  }

  async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Rev-Request': '1',
      ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };

    const res = await fetch(url, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Daemon request failed with status ${res.status}`);
    }
    return data as T;
  }
}
