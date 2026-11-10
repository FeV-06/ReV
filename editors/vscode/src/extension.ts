import * as vscode from 'vscode';
import path from 'node:path';
import { DaemonClient, type Project } from './daemonClient';
import { generateWebviewHtml, type WebviewState } from './webviewPanel';

export class RevExtensionManager {
  private client: DaemonClient;
  private currentPanel: vscode.WebviewPanel | undefined;
  private sidebarView: vscode.WebviewView | undefined;
  private statusBarItem: vscode.StatusBarItem;
  private state: WebviewState = {
    daemonStatus: 'connecting',
  };

  constructor(private context: vscode.ExtensionContext, client?: DaemonClient) {
    this.client = client || new DaemonClient();
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'rev.openHandover';
    this.statusBarItem.text = '$(layers) ReV';
    this.statusBarItem.tooltip = 'ReV: Software Handover Engine';
    this.statusBarItem.show();
    context.subscriptions.push(this.statusBarItem);
  }

  getActiveWorkspacePath(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    return folders[0].uri.fsPath;
  }

  async checkStatus(): Promise<void> {
    const ws = this.getActiveWorkspacePath();
    this.state.workspacePath = ws;
    this.state.error = undefined;

    try {
      const health = await this.client.getHealth(ws);
      this.state.daemonStatus = 'connected';
      this.state.daemonPort = health.port;
      this.statusBarItem.text = `$(layers) ReV :${health.port}`;
      this.statusBarItem.backgroundColor = undefined;

      if (ws) {
        const project = await this.client.findProjectByRoot(ws);
        this.state.project = project;

        // Auto-hydrate latest active run if currentRun is not yet loaded
        if (!this.state.currentRun) {
          try {
            const { runs } = await this.client.request<{ runs: any[] }>('/v1/runs', { workspaceRoot: ws });
            const activeRun = (runs || []).find((r: any) => ['needs_review', 'approved'].includes(r.state));
            if (activeRun) {
              const fullRun = await this.client.getRun(activeRun.id, ws);
              this.state.currentRun = fullRun;
            }
          } catch {}
        }
      }
    } catch (err) {
      this.state.daemonStatus = 'disconnected';
      this.state.daemonPort = undefined;
      this.statusBarItem.text = '$(layers) ReV (offline)';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    this.broadcastState();
  }

  private broadcastState(): void {
    if (this.currentPanel) {
      this.currentPanel.webview.html = generateWebviewHtml(this.currentPanel.webview, this.state);
      this.currentPanel.webview.postMessage({ type: 'SET_STATE', state: this.state });
    }
    if (this.sidebarView) {
      this.sidebarView.webview.html = generateWebviewHtml(this.sidebarView.webview, this.state);
      this.sidebarView.webview.postMessage({ type: 'SET_STATE', state: this.state });
    }
  }

  async registerCurrentWorkspace(githubUsername = 'FeV-06'): Promise<Project | undefined> {
    const ws = this.getActiveWorkspacePath();
    if (!ws) {
      vscode.window.showErrorMessage('No active workspace folder to register with ReV.');
      return undefined;
    }

    try {
      const project = await this.client.registerProject(ws, githubUsername, ws);
      this.state.project = project;
      this.state.error = undefined;
      this.broadcastState();
      vscode.window.showInformationMessage(`Registered ${path.basename(ws)} with ReV daemon.`);
      return project;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      this.state.error = msg;
      this.broadcastState();
      vscode.window.showErrorMessage(`ReV registration failed: ${msg}`);
      return undefined;
    }
  }

  async triggerScan(): Promise<void> {
    if (!this.state.project) {
      vscode.window.showWarningMessage('Workspace is not yet registered with ReV.');
      return;
    }

    try {
      const snapshot = await this.client.scanProject(this.state.project.id, this.state.workspacePath);
      this.state.project.snapshot = snapshot;
      this.state.error = undefined;
      this.broadcastState();
      const count = snapshot.changes ? snapshot.changes.length : (snapshot.uncommittedCount ?? 0);
      const commitStr = snapshot.commitCount !== undefined ? `${snapshot.commitCount} commits` : (snapshot.commitId ? `commit ${snapshot.commitId.slice(0, 7)}` : '0 commits');
      vscode.window.showInformationMessage(`ReV scan updated: ${commitStr}, ${count} working changes.`);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      this.state.error = msg;
      this.broadcastState();
      vscode.window.showErrorMessage(`ReV scan failed: ${msg}`);
    }
  }

  async createHandover(recipient: string, targetRole: string, fixture = false): Promise<void> {
    const ws = this.getActiveWorkspacePath();
    const username = this.state.project?.githubUsername || 'FeV-06';

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'ReV: Synthesizing handover with OmniRoute (gemini-3.8-flash-high)...',
        cancellable: false,
      },
      async () => {
        try {
          const run = await this.client.createRun(
            {
              recipient,
              githubUsername: username,
              targetRole,
              projectRoot: ws,
              localGit: true,
              fixture,
            },
            ws
          );

          // Select all candidate artifacts and confirm scope first
          const selectedIds = (run.artifacts || []).map((a: any) => a.id);
          await this.client.updateRunAction(
            run.id,
            {
              action: 'scope',
              selectedIds,
            },
            ws
          );

          const generated = await this.client.updateRunAction(
            run.id,
            {
              action: 'generate',
              selectedIds,
              acceptPartial: true,
              confirmAuthorisation: true,
              confirmRemote: !fixture,
              fixture,
            },
            ws
          );

          this.state.currentRun = generated;
          this.state.error = undefined;
          this.broadcastState();
          vscode.window.showInformationMessage(
            `Synthesized handover for ${recipient} (${targetRole}) with ${generated.items?.length || 0} evidence-backed claims.`
          );
        } catch (err: any) {
          const msg = err instanceof Error ? err.message : String(err);
          this.state.error = msg;
          this.broadcastState();
          vscode.window.showErrorMessage(`Handover synthesis failed: ${msg}`);
        }
      }
    );
  }

  async approveHandover(): Promise<void> {
    if (!this.state.currentRun) return;
    const ws = this.getActiveWorkspacePath();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'ReV: Approving handover revision in PGlite...',
        cancellable: false,
      },
      async () => {
        try {
          const approved = await this.client.updateRunAction(
            this.state.currentRun.id,
            {
              action: 'approve',
              confirmAuthorisation: true,
            },
            ws
          );

          this.state.currentRun = approved;
          this.state.error = undefined;
          this.broadcastState();
          vscode.window.showInformationMessage('Handover revision approved and sealed.');
        } catch (err: any) {
          const msg = err instanceof Error ? err.message : String(err);
          this.state.error = msg;
          this.broadcastState();
          vscode.window.showErrorMessage(`Approval failed: ${msg}`);
        }
      }
    );
  }

  async exportHandover(): Promise<void> {
    if (!this.state.currentRun || this.state.currentRun.state !== 'approved') {
      vscode.window.showWarningMessage('Only approved handovers can be exported.');
      return;
    }
    const ws = this.getActiveWorkspacePath();
    if (!ws) return;

    try {
      const markdown = await this.client.exportMarkdown(this.state.currentRun.id, ws);
      const targetUri = vscode.Uri.file(path.join(ws, 'HANDOVER.md'));
      await vscode.workspace.fs.writeFile(targetUri, Buffer.from(markdown, 'utf8'));

      this.state.exportSuccess = `Saved HANDOVER.md to workspace root.`;
      this.broadcastState();

      const doc = await vscode.workspace.openTextDocument(targetUri);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage('Exported HANDOVER.md to workspace root.');
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      this.state.error = msg;
      this.broadcastState();
      vscode.window.showErrorMessage(`Export failed: ${msg}`);
    }
  }

  handleWebviewMessage(message: any): void {
    switch (message.type) {
      case 'CHECK_STATUS':
        void this.checkStatus();
        break;
      case 'REGISTER_WORKSPACE':
        void this.registerCurrentWorkspace(message.githubUsername);
        break;
      case 'TRIGGER_SCAN':
        void this.triggerScan();
        break;
      case 'OPEN_DASHBOARD':
        void vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${this.state.daemonPort || 3077}/`));
        break;
      case 'CREATE_HANDOVER':
        void this.createHandover(message.recipient, message.targetRole);
        break;
      case 'APPROVE_HANDOVER':
        void this.approveHandover();
        break;
      case 'EXPORT_HANDOVER':
        void this.exportHandover();
        break;
      case 'RESET_RUN':
        this.state.currentRun = undefined;
        this.state.exportSuccess = undefined;
        this.broadcastState();
        break;
      default:
        break;
    }
  }

  async openHandoverPanel(): Promise<vscode.WebviewPanel> {
    await this.checkStatus();

    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.One);
      this.currentPanel.webview.html = generateWebviewHtml(this.currentPanel.webview, this.state);
      return this.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'revHandover',
      'ReV Handover Workspace',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.currentPanel = panel;
    panel.webview.html = generateWebviewHtml(panel.webview, this.state);
    panel.onDidDispose(() => {
      this.currentPanel = undefined;
    });

    panel.webview.onDidReceiveMessage(msg => this.handleWebviewMessage(msg));
    return panel;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.sidebarView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = generateWebviewHtml(webviewView.webview, this.state);
    webviewView.webview.onDidReceiveMessage(msg => this.handleWebviewMessage(msg));
    void this.checkStatus();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const manager = new RevExtensionManager(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('rev.openHandover', () => manager.openHandoverPanel()),
    vscode.commands.registerCommand('rev.registerWorkspace', async () => {
      const username = await vscode.window.showInputBox({
        prompt: 'Enter your GitHub username to link with this project',
        value: 'FeV-06',
      });
      if (username) void manager.registerCurrentWorkspace(username);
    }),
    vscode.commands.registerCommand('rev.syncCapture', () => manager.triggerScan()),
    vscode.commands.registerCommand('rev.daemonStatus', async () => {
      await manager.checkStatus();
      vscode.window.showInformationMessage(`ReV Status: ${manager['state'].daemonStatus}`);
    }),
    vscode.commands.registerCommand('rev.openDashboard', () => {
      void vscode.env.openExternal(vscode.Uri.parse('http://127.0.0.1:3077/'));
    }),
    vscode.commands.registerCommand('rev.createHandover', () => manager.createHandover('Successor Engineer', 'Backend engineer')),
    vscode.commands.registerCommand('rev.approveHandover', () => manager.approveHandover()),
    vscode.commands.registerCommand('rev.exportHandover', () => manager.exportHandover()),
    vscode.window.registerWebviewViewProvider('rev.sidebarView', {
      resolveWebviewView: (view: vscode.WebviewView) => manager.resolveWebviewView(view),
    })
  );
}

export function deactivate(): void {}
