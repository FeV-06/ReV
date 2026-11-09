'use client';
import { useEffect, useState } from 'react';

type WorkingChange = { path: string; indexStatus: string; worktreeStatus: string };
type ProjectSnapshot = {
  id: string;
  projectId: string;
  observedAt: string;
  baseline: boolean;
  commitId: string | null;
  branch: string | null;
  changes: WorkingChange[];
  excludedCount: number;
};
type Project = {
  id: string;
  root: string;
  githubUsername: string;
  paused: boolean;
  captureStatus: 'active' | 'not_implemented' | 'paused';
  snapshot?: ProjectSnapshot | null;
};

async function api(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Rev-Request': '1', ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function ProjectDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [root, setRoot] = useState('');
  const [username, setUsername] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');

  async function refresh() {
    try {
      const [health, listing] = await Promise.all([
        api('/api/daemon/health'),
        api('/api/projects'),
      ]);
      if (health.protocol !== 1) throw new Error('Unsupported daemon protocol');
      setProjects(listing.projects);
      setStatus('online');
      setConnectionError('');
    } catch (e) {
      setStatus('offline');
      setConnectionError(e instanceof Error ? e.message : 'Daemon unavailable');
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  async function register(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ root, githubUsername: username, confirmWatch: consent }),
      });
      setRoot('');
      setConsent(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not register project');
    } finally {
      setBusy(false);
    }
  }

  async function togglePause(project: Project) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ paused: !project.paused }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update project state');
    } finally {
      setBusy(false);
    }
  }

  async function scanNow(project: Project) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/projects/${project.id}/scan`, { method: 'POST' });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Manual scan failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(project: Project) {
    if (!confirm(`Remove ${project.root} from ReV? The repository will not be deleted.`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/projects/${project.id}`, { method: 'DELETE' });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove project');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card compact" aria-labelledby="project-dashboard-title">
      <div className="eyebrow">DAEMON PROJECTS</div>
      <h2 id="project-dashboard-title">Local projects</h2>
      <p role="status">
        Daemon: <b>{status === 'checking' ? 'Checking' : status === 'online' ? 'Connected' : 'Unavailable'}</b>
        {status === 'online' ? ' · protocol 1' : ''}
      </p>
      {status === 'offline' && (
        <div className="warning">
          <strong>Daemon unavailable</strong>
          <p>{connectionError}</p>
          <button type="button" className="secondary" onClick={() => void refresh()}>
            Retry connection
          </button>
        </div>
      )}
      {status !== 'offline' && error && <div role="alert" className="error">{error}</div>}
      {status === 'online' && (
        <>
          <form onSubmit={register}>
            <label>
              Git project root
              <input
                value={root}
                onChange={e => setRoot(e.target.value)}
                placeholder="Absolute path to Git root"
                maxLength={4096}
                required
              />
            </label>
            <label>
              Project GitHub username
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="GitHub username without @"
                maxLength={39}
                required
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={consent}
                onChange={e => setConsent(e.target.checked)}
                required
              />{' '}
              I authorize ReV to register this directory for future local capture.
            </label>
            <button type="submit" disabled={busy || !root || !username || !consent}>
              Register project
            </button>
          </form>
          {projects.length === 0 ? (
            <p>No projects registered.</p>
          ) : (
            <div className="runs">
              {projects.map(project => (
                <div className="project-record" key={project.id}>
                  <strong>{project.root}</strong>
                  <small>
                    GitHub: @{project.githubUsername} · {project.paused ? (project.snapshot ? 'Capture paused' : 'Capture not implemented') : 'Watching active'}
                  </small>
                  {project.snapshot && (
                    <small>
                      HEAD: {project.snapshot.branch || 'detached'} @ {project.snapshot.commitId ? project.snapshot.commitId.slice(0, 7) : 'empty'} · {project.snapshot.changes.length} uncommitted file(s)
                    </small>
                  )}
                  <div className="button-row">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void togglePause(project)}
                    >
                      {project.paused ? 'Resume' : 'Pause'}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || project.paused}
                      onClick={() => void scanNow(project)}
                    >
                      Scan now
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() => void remove(project)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
