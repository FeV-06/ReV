import { describe, expect, it, vi, beforeEach } from 'vitest';
import path from 'node:path';

// Construct hoisted mock of VS Code runtime
const { mockStatusBar, mockWebview, mockPanel, mockVsCode } = vi.hoisted(() => {
  const mockStatusBar = {
    text: '',
    tooltip: '',
    command: '',
    backgroundColor: undefined as any,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };

  const mockWebview = {
    html: '',
    cspSource: 'vscode-webview:',
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn(),
  };

  const mockPanel = {
    webview: mockWebview,
    reveal: vi.fn(),
    onDidDispose: vi.fn(),
    dispose: vi.fn(),
  };

  const mockVsCode = {
    window: {
      createStatusBarItem: vi.fn(() => mockStatusBar),
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showInputBox: vi.fn(),
      createWebviewPanel: vi.fn(() => mockPanel),
      showTextDocument: vi.fn(),
      registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
      withProgress: vi.fn((_opts, task) => task({ report: vi.fn() })),
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/home/fev/projects/test-project' } }],
      fs: {
        writeFile: vi.fn(),
      },
      openTextDocument: vi.fn(() => Promise.resolve({ uri: { fsPath: '/home/fev/projects/test-project/HANDOVER.md' } })),
    },
    commands: {
      registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    },
    env: {
      openExternal: vi.fn(),
    },
    Uri: {
      file: (p: string) => ({ fsPath: p, scheme: 'file' }),
      parse: (url: string) => ({ toString: () => url, scheme: 'http' }),
    },
    StatusBarAlignment: { Right: 2 },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15, SourceControl: 1, Window: 10 },
    ThemeColor: class {
      constructor(public id: string) {}
    },
  };

  return { mockStatusBar, mockWebview, mockPanel, mockVsCode };
});

vi.mock('vscode', () => mockVsCode);

import { RevExtensionManager, activate } from '../editors/vscode/src/extension';
import type { DaemonClient } from '../editors/vscode/src/daemonClient';

describe('RevExtensionManager lifecycle and UI interactions', () => {
  let mockClient: any;
  let mockContext: any;
  let manager: RevExtensionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = {
      subscriptions: [],
    };
    mockClient = {
      getHealth: vi.fn().mockResolvedValue({ status: 'ok', protocol: 1, port: 3078 }),
      findProjectByRoot: vi.fn().mockResolvedValue({
        id: 'proj-123',
        root: '/home/fev/projects/test-project',
        githubUsername: 'FeV-06',
        gitCommonDir: '/home/fev/projects/test-project/.git',
        createdAt: '2026-11-09T00:00:00Z',
        paused: false,
        captureStatus: 'active',
        snapshot: {
          id: 'snap-1',
          projectId: 'proj-123',
          observedAt: '2026-11-09T00:00:00Z',
          fingerprint: 'abcdef',
          commitCount: 42,
          uncommittedCount: 3,
          baseline: true,
        },
      }),
      registerProject: vi.fn().mockResolvedValue({
        id: 'proj-new',
        root: '/home/fev/projects/test-project',
        githubUsername: 'FeV-06',
        paused: false,
      }),
      scanProject: vi.fn().mockResolvedValue({
        id: 'snap-2',
        projectId: 'proj-123',
        commitCount: 43,
        uncommittedCount: 0,
        baseline: false,
      }),
      createRun: vi.fn().mockResolvedValue({
        id: 'run-1',
        recipient: 'Successor Engineer',
        githubUsername: 'FeV-06',
        targetRole: 'Backend engineer',
        artifacts: [{ id: 'art-1', kind: 'github_commit' }],
      }),
      updateRunAction: vi.fn().mockImplementation((runId, body) => {
        if (body.action === 'scope') {
          return Promise.resolve({ id: runId, selectedIds: body.selectedIds });
        }
        if (body.action === 'generate') {
          return Promise.resolve({
            id: runId,
            state: 'review',
            items: [{ id: 'i-1', text: 'Important architecture claim', category: 'architecture', verified: true }],
          });
        }
        if (body.action === 'approve') {
          return Promise.resolve({ id: runId, state: 'approved' });
        }
        return Promise.resolve({ id: runId });
      }),
      exportMarkdown: vi.fn().mockResolvedValue('# Approved Handover\nEvidence validated.'),
    };

    manager = new RevExtensionManager(mockContext, mockClient as unknown as DaemonClient);
  });

  it('initializes status bar and subscriptions cleanly', () => {
    expect(mockStatusBar.show).toHaveBeenCalled();
    expect(mockStatusBar.command).toBe('rev.openHandover');
    expect(mockStatusBar.text).toBe('$(layers) ReV');
    expect(mockContext.subscriptions).toContain(mockStatusBar);
  });

  it('updates status bar and state when daemon is connected', async () => {
    await manager.checkStatus();

    expect(mockClient.getHealth).toHaveBeenCalled();
    expect(mockStatusBar.text).toBe('$(layers) ReV :3078');
    expect(mockStatusBar.backgroundColor).toBeUndefined();
    expect((manager as any).state.daemonStatus).toBe('connected');
    expect((manager as any).state.daemonPort).toBe(3078);
    expect((manager as any).state.project?.id).toBe('proj-123');
  });

  it('handles offline daemon gracefully without throwing exceptions', async () => {
    mockClient.getHealth.mockRejectedValueOnce(new Error('Connection refused'));

    await manager.checkStatus();

    expect(mockStatusBar.text).toBe('$(layers) ReV (offline)');
    expect(mockStatusBar.backgroundColor).toBeDefined();
    expect((manager as any).state.daemonStatus).toBe('disconnected');
    expect((manager as any).state.daemonPort).toBeUndefined();
  });

  it('registers current workspace and notifies user', async () => {
    const project = await manager.registerCurrentWorkspace('FeV-06');

    expect(mockClient.registerProject).toHaveBeenCalledWith(
      '/home/fev/projects/test-project',
      'FeV-06',
      '/home/fev/projects/test-project'
    );
    expect(project).toBeDefined();
    expect(project?.id).toBe('proj-new');
    expect(mockVsCode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Registered test-project with ReV daemon')
    );
  });

  it('handles registration failure cleanly', async () => {
    mockClient.registerProject.mockRejectedValueOnce(new Error('Already registered in daemon'));

    const project = await manager.registerCurrentWorkspace('FeV-06');

    expect(project).toBeUndefined();
    expect(mockVsCode.window.showErrorMessage).toHaveBeenCalledWith(
      'ReV registration failed: Already registered in daemon'
    );
    expect((manager as any).state.error).toBe('Already registered in daemon');
  });

  it('triggers on-demand scan and updates project stats', async () => {
    await manager.checkStatus();
    await manager.triggerScan();

    expect(mockClient.scanProject).toHaveBeenCalledWith('proj-123', '/home/fev/projects/test-project');
    expect((manager as any).state.project.snapshot.commitCount).toBe(43);
    expect(mockVsCode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('ReV scan updated: 43 commits, 0 working changes')
    );
  });

  it('executes full handover workflow: create -> scope -> generate -> approve -> export', async () => {
    await manager.checkStatus();

    // 1. Create and generate handover
    await manager.createHandover('Successor Lead', 'Backend engineer');
    expect(mockClient.createRun).toHaveBeenCalledWith({
      recipient: 'Successor Lead',
      githubUsername: 'FeV-06',
      targetRole: 'Backend engineer',
      projectRoot: '/home/fev/projects/test-project',
      localGit: true,
      fixture: false,
    }, '/home/fev/projects/test-project');

    expect(mockClient.updateRunAction).toHaveBeenCalledWith('run-1', {
      action: 'scope',
      selectedIds: ['art-1'],
    }, '/home/fev/projects/test-project');

    expect(mockClient.updateRunAction).toHaveBeenCalledWith('run-1', {
      action: 'generate',
      selectedIds: ['art-1'],
      acceptPartial: true,
      confirmAuthorisation: true,
      confirmRemote: true,
      fixture: false,
    }, '/home/fev/projects/test-project');

    expect((manager as any).state.currentRun.state).toBe('review');

    // 2. Approve handover
    await manager.approveHandover();
    expect(mockClient.updateRunAction).toHaveBeenCalledWith('run-1', {
      action: 'approve',
      confirmAuthorisation: true,
    }, '/home/fev/projects/test-project');
    expect((manager as any).state.currentRun.state).toBe('approved');

    // 3. Export to workspace HANDOVER.md
    await manager.exportHandover();
    expect(mockClient.exportMarkdown).toHaveBeenCalledWith('run-1', '/home/fev/projects/test-project');
    expect(mockVsCode.workspace.fs.writeFile).toHaveBeenCalled();
    expect(mockVsCode.window.showInformationMessage).toHaveBeenCalledWith(
      'Exported HANDOVER.md to workspace root.'
    );
  });

  it('blocks export when current run is not approved', async () => {
    (manager as any).state.currentRun = { id: 'run-unapproved', state: 'review' };
    await manager.exportHandover();

    expect(mockClient.exportMarkdown).not.toHaveBeenCalled();
    expect(mockVsCode.window.showWarningMessage).toHaveBeenCalledWith(
      'Only approved handovers can be exported.'
    );
  });

  it('routes webview IPC messages to corresponding actions', () => {
    const spyCheck = vi.spyOn(manager, 'checkStatus');
    const spyReg = vi.spyOn(manager, 'registerCurrentWorkspace');
    const spyScan = vi.spyOn(manager, 'triggerScan');
    const spyCreate = vi.spyOn(manager, 'createHandover');
    const spyApprove = vi.spyOn(manager, 'approveHandover');
    const spyExport = vi.spyOn(manager, 'exportHandover');

    manager.handleWebviewMessage({ type: 'CHECK_STATUS' });
    expect(spyCheck).toHaveBeenCalled();

    manager.handleWebviewMessage({ type: 'REGISTER_WORKSPACE', githubUsername: 'FeV-06' });
    expect(spyReg).toHaveBeenCalledWith('FeV-06');

    manager.handleWebviewMessage({ type: 'TRIGGER_SCAN' });
    expect(spyScan).toHaveBeenCalled();

    manager.handleWebviewMessage({ type: 'CREATE_HANDOVER', recipient: 'Alice', targetRole: 'QA engineer' });
    expect(spyCreate).toHaveBeenCalledWith('Alice', 'QA engineer');

    manager.handleWebviewMessage({ type: 'APPROVE_HANDOVER' });
    expect(spyApprove).toHaveBeenCalled();

    manager.handleWebviewMessage({ type: 'EXPORT_HANDOVER' });
    expect(spyExport).toHaveBeenCalled();

    manager.handleWebviewMessage({ type: 'OPEN_DASHBOARD' });
    expect(mockVsCode.env.openExternal).toHaveBeenCalled();

    (manager as any).state.currentRun = { id: 'test' };
    manager.handleWebviewMessage({ type: 'RESET_RUN' });
    expect((manager as any).state.currentRun).toBeUndefined();
  });

  it('activates extension commands and webview provider', () => {
    activate(mockContext);
    expect(mockVsCode.commands.registerCommand).toHaveBeenCalledWith('rev.openHandover', expect.any(Function));
    expect(mockVsCode.commands.registerCommand).toHaveBeenCalledWith('rev.registerWorkspace', expect.any(Function));
    expect(mockVsCode.commands.registerCommand).toHaveBeenCalledWith('rev.syncCapture', expect.any(Function));
    expect(mockVsCode.commands.registerCommand).toHaveBeenCalledWith('rev.daemonStatus', expect.any(Function));
    expect(mockVsCode.commands.registerCommand).toHaveBeenCalledWith('rev.openDashboard', expect.any(Function));
    expect(mockVsCode.window.registerWebviewViewProvider).toHaveBeenCalledWith('rev.sidebarView', expect.any(Object));
  });
});
