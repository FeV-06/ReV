import { describe, expect, it } from 'vitest';
import { generateWebviewHtml, type WebviewState } from '../editors/vscode/src/webviewPanel';

const mockWebview: any = {
  cspSource: 'vscode-webview:',
};

describe('Webview rendering across all lifecycle states', () => {
  it('renders disconnected state when daemon is offline', () => {
    const state: WebviewState = {
      daemonStatus: 'disconnected',
      workspacePath: '/home/fev/projects/my-app',
    };

    const html = generateWebviewHtml(mockWebview, state);
    expect(html).toContain('Daemon Offline');
    expect(html).toContain('pill-disconnected');
    expect(html).toContain('Daemon Disconnected');
    expect(html).toContain('Start Local Daemon');
  });

  it('renders connecting state while daemon probe is in flight', () => {
    const state: WebviewState = {
      daemonStatus: 'connecting',
      workspacePath: '/home/fev/projects/my-app',
    };

    const html = generateWebviewHtml(mockWebview, state);
    expect(html).toContain('Connecting...');
    expect(html).toContain('pill-connecting');
  });

  it('renders empty prompt when no workspace folder is open', () => {
    const state: WebviewState = {
      daemonStatus: 'connected',
      daemonPort: 3078,
      workspacePath: undefined,
    };

    const html = generateWebviewHtml(mockWebview, state);
    expect(html).toContain('No Workspace Folder Open');
    expect(html).toContain('Open a project folder in VS Code to activate ReV handover capture.');
  });

  it('renders registration form for unregistered workspace', () => {
    const state: WebviewState = {
      daemonStatus: 'connected',
      daemonPort: 3078,
      workspacePath: '/home/fev/projects/new-app',
      project: undefined,
    };

    const html = generateWebviewHtml(mockWebview, state);
    expect(html).toContain('Unregistered Workspace');
    expect(html).toContain('Register Folder with ReV');
    expect(html).toContain('reg-username');
    expect(html).toContain('FeV-06');
  });

  it('renders project stats and handover generator for registered project', () => {
    const state: WebviewState = {
      daemonStatus: 'connected',
      daemonPort: 3078,
      workspacePath: '/home/fev/projects/active-app',
      project: {
        id: 'proj-1',
        root: '/home/fev/projects/active-app',
        githubUsername: 'FeV-06',
        gitCommonDir: '/home/fev/projects/active-app/.git',
        createdAt: new Date().toISOString(),
        paused: false,
        captureStatus: 'active',
        snapshot: {
          id: 's-1',
          projectId: 'proj-1',
          observedAt: new Date().toISOString(),
          fingerprint: 'abcd1234ef',
          commitCount: 25,
          uncommittedCount: 4,
          baseline: true,
        },
      },
    };

    const html = generateWebviewHtml(mockWebview, state);
    expect(html).toContain('Watched Project: active-app');
    expect(html).toContain('FeV-06');
    expect(html).toContain('25');
    expect(html).toContain('4');
    expect(html).toContain('Handover Generator');
    expect(html).toContain('target-recipient');
    expect(html).toContain('Backend Engineer');
    expect(html).toContain('Full-Stack Engineer');
    expect(html).toContain('Staff / Lead Engineer');
    expect(html).toContain('Generate Handover');
  });

  it('renders review workbench with unapproved run and citation badges', () => {
    const state: WebviewState = {
      daemonStatus: 'connected',
      daemonPort: 3078,
      workspacePath: '/home/fev/projects/active-app',
      project: {
        id: 'proj-1',
        root: '/home/fev/projects/active-app',
        githubUsername: 'FeV-06',
        gitCommonDir: '/home/fev/projects/active-app/.git',
        createdAt: new Date().toISOString(),
        paused: false,
        captureStatus: 'active',
      },
      currentRun: {
        id: 'run-1',
        state: 'review',
        targetRole: 'Backend engineer',
        items: [
          {
            id: 'item-1',
            text: 'Database pooling requires max connections set to 20',
            category: 'architecture',
            verified: true,
            citations: [{ sourceKind: 'github_commit', sourceExternalId: 'a1b2c3d' }],
          },
          {
            id: 'item-2',
            text: 'Auth service restart script missing systemd linger',
            category: 'risks',
            verified: false,
            citations: [],
          },
        ],
      },
    };

    const html = generateWebviewHtml(mockWebview, state);
    expect(html).toContain('Status:');
    expect(html).toContain('review');
    expect(html).toContain('Role: Backend engineer');
    expect(html).toContain('Database pooling requires max connections set to 20');
    expect(html).toContain('github_commit:a1b2c3d');
    expect(html).toContain('Approve Handover');
    // Export should be disabled while unapproved
    expect(html).toContain('disabled');
  });

  it('enables export button when handover is approved', () => {
    const state: WebviewState = {
      daemonStatus: 'connected',
      daemonPort: 3078,
      workspacePath: '/home/fev/projects/active-app',
      project: {
        id: 'proj-1',
        root: '/home/fev/projects/active-app',
        githubUsername: 'FeV-06',
        gitCommonDir: '/home/fev/projects/active-app/.git',
        createdAt: new Date().toISOString(),
        paused: false,
        captureStatus: 'active',
      },
      currentRun: {
        id: 'run-1',
        state: 'approved',
        items: [{ id: 'item-1', text: 'All systems green', category: 'workflows', verified: true }],
      },
    };

    const html = generateWebviewHtml(mockWebview, state);
    expect(html).toContain('approved');
    expect(html).toContain('Export HANDOVER.md');
    // Approve button should no longer show in the markup
    expect(html).not.toContain('Approve Handover');
  });

  it('displays error and success alerts correctly', () => {
    const state: WebviewState = {
      daemonStatus: 'connected',
      workspacePath: '/home/fev/projects/app',
      error: 'Failed to communicate with daemon',
      exportSuccess: 'Exported HANDOVER.md successfully',
    };

    const html = generateWebviewHtml(mockWebview, state);
    expect(html).toContain('alert-error');
    expect(html).toContain('Failed to communicate with daemon');
    expect(html).toContain('alert-success');
    expect(html).toContain('Exported HANDOVER.md successfully');
  });
});
