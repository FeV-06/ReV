import type * as vscode from 'vscode';
import { DaemonClient, type Project } from '../daemonClient';
import { TEAM_ACTIONS, type TeamAction, type TeamRequestMessage } from './types';
import { createTeamRequestHandler, type TeamRequestHandlerDeps } from './teamHost';

export interface TeamPanelConfig {
  /** Absolute path of the workspace folder this panel instance serves. */
  workspacePath: string | undefined;
  /** Called on every webview->host message; used by tests to observe traffic. */
  onMessage?: (message: unknown) => void;
}

/**
 * Host-side lifecycle wrapper for one webview instance carrying the shared
 * team sync React panel. Owns the message subscription and disposes it with
 * the webview. Workspace isolation: the injected root is fixed at
 * construction; a workspace switch disposes this controller and creates a new
 * one for the new root.
 */
export class TeamWebviewController {
  readonly controllerId: string;
  private handler: (raw: unknown) => Promise<unknown>;
  private disposed = false;

  constructor(
    private readonly deps: TeamRequestHandlerDeps,
    private readonly webview: vscode.Webview,
    config: TeamPanelConfig
  ) {
    this.controllerId = config.workspacePath ?? '(no-workspace)';
    this.handler = createTeamRequestHandler(deps);
    const subscription = this.webview.onDidReceiveMessage((msg: unknown) => {
      if (this.disposed) return;
      config.onMessage?.(msg);
      const raw = msg as TeamRequestMessage | { type?: string };
      if (raw && typeof raw === 'object' && (raw as TeamRequestMessage).type === 'TEAM_REQUEST') {
        void this.handleTeamRequest(raw as TeamRequestMessage);
      }
      // Non-team messages (e.g. legacy SET_STATE actions) are ignored here;
      // the handover panel keeps its own handler.
    });
    if (typeof (this.webview as { onDidDispose?: unknown }).onDidDispose === 'function') {
      const disposable = (
        this.webview as unknown as { onDidDispose: (cb: () => void) => { dispose(): unknown } }
      ).onDidDispose(() => this.dispose());
      this.disposables.push(disposable);
    }
    this.disposables.push(subscription);
  }

  private disposables: { dispose(): unknown }[] = [];

  private async handleTeamRequest(message: TeamRequestMessage): Promise<void> {
    const response = (await this.handler(message)) as { id: string };
    if (this.disposed) return;
    void this.webview.postMessage(response);
  }

  /** Idempotent teardown: clears the message subscription and pending state. */
  dispose(): void {
    this.disposed = true;
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        // Ignore disposal races when the webview is already gone.
      }
    }
    this.disposables = [];
  }
}

export function createTeamDaemonDeps(
  client: DaemonClient,
  getWorkspacePath: () => string | undefined
): TeamRequestHandlerDeps {
  return {
    callDaemon: (route, options) => client.request(route, options),
    getWorkspacePath,
  };
}

/** Typed helper for hosts that want to pre-warm status on panel open. */
export function requestTeamStatus(
  deps: TeamRequestHandlerDeps,
  id = 'rev-team-prewarm000'
): Promise<unknown> {
  const message: TeamRequestMessage = { type: 'TEAM_REQUEST', id, action: 'status', payload: {} };
  return createTeamRequestHandler(deps)(message);
}

export const TEAM_ACTION_LIST: readonly TeamAction[] = TEAM_ACTIONS;
export type { Project };
