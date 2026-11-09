import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

export interface ProjectSnapshot {
  id: string;
  projectId: string;
  observedAt: string;
  fingerprint: string;
  commitId?: string;
  commitCount?: number;
  uncommittedCount?: number;
  changes?: unknown[];
  baseline: boolean;
}

export interface Project {
  id: string;
  root: string;
  githubUsername: string;
  gitCommonDir: string;
  gitDir?: string;
  createdAt: string;
  paused: boolean;
  captureStatus: string;
  snapshot?: ProjectSnapshot;
}

export interface DaemonState {
  protocol: number;
  port: number;
  pid: number;
  tokenHash: string;
}

export interface DaemonHealth {
  status: string;
  protocol: number;
  port: number;
}

export function normalizePath(p: string): string {
  const norm = path.normalize(path.resolve(p));
  return process.platform === 'win32' ? norm.toLowerCase() : norm;
}

export function pathContains(parent: string, child: string): boolean {
  const normParent = normalizePath(parent);
  const normChild = normalizePath(child);
  if (normParent === normChild) return true;
  const rel = path.relative(normParent, normChild);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export class DaemonClient {
  private customDataDir?: string;

  constructor(customDataDir?: string) {
    this.customDataDir = customDataDir;
  }

  async resolveDataDir(workspaceRoot?: string): Promise<string> {
    if (this.customDataDir) return path.resolve(this.customDataDir);
    if (process.env.REV_DATA_DIR) return path.resolve(process.env.REV_DATA_DIR);

    // If workspace folder has a local .rev-data directory
    if (workspaceRoot) {
      const localDataDir = path.join(workspaceRoot, '.rev-data');
      try {
        const metadata = await readFile(path.join(localDataDir, 'daemon.json'), 'utf8');
        if (metadata) return localDataDir;
      } catch {}
    }

    // Default global location: ~/.rev-data
    return path.join(homedir(), '.rev-data');
  }

  async getConnection(workspaceRoot?: string): Promise<{ port: number; token: string }> {
    const dataDir = await this.resolveDataDir(workspaceRoot);
    const statePath = path.join(dataDir, 'daemon.json');
    const tokenPath = path.join(dataDir, 'daemon.token');

    let state: DaemonState;
    let token: string;

    try {
      state = JSON.parse(await readFile(statePath, 'utf8')) as DaemonState;
      token = (await readFile(tokenPath, 'utf8')).trim();
    } catch {
      throw new Error(`ReV daemon is not running or unreachable at ${dataDir}. Start the daemon first.`);
    }

    const calculatedHash = createHash('sha256').update(token).digest('hex');
    if (calculatedHash !== state.tokenHash) {
      throw new Error('Mismatched daemon token hash; refusing connection.');
    }

    return { port: state.port, token };
  }

  async request<T>(route: string, options: { method?: string; body?: unknown; workspaceRoot?: string } = {}): Promise<T> {
    const { port, token } = await this.getConnection(options.workspaceRoot);
    const url = `http://127.0.0.1:${port}${route}`;

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    };

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      let errMsg = `Daemon request failed (${response.status})`;
      try {
        const errJson = (await response.json()) as { error?: string };
        if (errJson.error) errMsg = errJson.error;
      } catch {}
      throw new Error(errMsg);
    }

    if (response.headers.get('content-type')?.includes('application/json')) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  async getHealth(workspaceRoot?: string): Promise<DaemonHealth> {
    const res = await this.request<{ status: string; protocol: number }>('/v1/health', { workspaceRoot });
    const { port } = await this.getConnection(workspaceRoot);
    return { ...res, port };
  }

  async listProjects(workspaceRoot?: string): Promise<Project[]> {
    const res = await this.request<{ projects: Project[] }>('/v1/projects', { workspaceRoot });
    return res.projects;
  }

  async findProjectByRoot(targetRoot: string): Promise<Project | undefined> {
    const projects = await this.listProjects(targetRoot);
    const normTarget = normalizePath(targetRoot);
    return projects.find(p => normalizePath(p.root) === normTarget || pathContains(p.root, targetRoot));
  }

  async registerProject(root: string, githubUsername: string, workspaceRoot?: string): Promise<Project> {
    const res = await this.request<{ project: Project }>('/v1/projects', {
      method: 'POST',
      body: { root, githubUsername, confirmWatch: true },
      workspaceRoot: workspaceRoot || root,
    });
    return res.project;
  }

  async scanProject(projectId: string, workspaceRoot?: string): Promise<ProjectSnapshot> {
    const res = await this.request<{ snapshot: ProjectSnapshot }>(`/v1/projects/${projectId}/scan`, {
      method: 'POST',
      workspaceRoot,
    });
    return res.snapshot;
  }

  async setProjectPaused(projectId: string, paused: boolean, workspaceRoot?: string): Promise<Project> {
    const res = await this.request<{ project: Project }>(`/v1/projects/${projectId}`, {
      method: 'PATCH',
      body: { paused },
      workspaceRoot,
    });
    return res.project;
  }

  async createRun(payload: {
    recipient: string;
    githubUsername: string;
    targetRole: string;
    repo?: string;
    fixture?: boolean;
  }, workspaceRoot?: string): Promise<any> {
    const res = await this.request<{ run: any }>('/v1/runs', {
      method: 'POST',
      body: payload,
      workspaceRoot,
    });
    return res.run;
  }

  async getRun(runId: string, workspaceRoot?: string): Promise<any> {
    const res = await this.request<{ run: any }>(`/v1/runs/${runId}`, { workspaceRoot });
    return res.run;
  }

  async updateRunAction(runId: string, actionBody: Record<string, unknown>, workspaceRoot?: string): Promise<any> {
    const res = await this.request<{ run: any }>(`/v1/runs/${runId}`, {
      method: 'PATCH',
      body: actionBody,
      workspaceRoot,
    });
    return res.run;
  }

  async exportMarkdown(runId: string, workspaceRoot?: string): Promise<string> {
    return this.request<string>(`/v1/runs/${runId}/export`, {
      method: 'GET',
      workspaceRoot,
    });
  }
}
