import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import TeamSyncPanel, {
  type TeamSyncPanelProps,
} from '../../../../src/components/team/TeamSyncPanel';
import { TEAM_BOOTSTRAP_KEY } from './teamPanelHtml';
import { createWebviewTeamTransport, type WebviewTeamTransport } from './webviewTransport';

declare const acquireVsCodeApi: () => { postMessage(message: unknown): void };

interface TeamBootstrap {
  workspacePath?: string | null;
}

function readBootstrap(): TeamBootstrap {
  const raw = (window as unknown as Record<string, unknown>)[TEAM_BOOTSTRAP_KEY];
  if (raw && typeof raw === 'object') return raw as TeamBootstrap;
  return {};
}

export function mountTeamPanel(mountElement: HTMLElement): { dispose(): void } {
  const vscode = acquireVsCodeApi();
  const bootstrap = readBootstrap();
  const transport: WebviewTeamTransport = createWebviewTeamTransport(vscode);
  const root: Root = createRoot(mountElement);

  // The shared panel contract pins the host workspace via `activeProjectRoot`;
  // with it set the panel hides its local project-root input and sends the
  // pinned root with every project-scoped request (host re-validates anyway).
  const props: TeamSyncPanelProps = {
    transport,
    activeProjectRoot: bootstrap.workspacePath ?? undefined,
  };

  root.render(React.createElement(TeamSyncPanel, props));

  return {
    dispose(): void {
      transport.dispose();
      setTimeout(() => {
        root.unmount();
      }, 0);
    },
  };
}

// Auto-mount when bundled for the webview (browser environment with #root).
if (typeof document !== 'undefined') {
  const mount = document.getElementById('root');
  if (mount) {
    (window as unknown as Record<string, unknown>).__revTeamPanel = mountTeamPanel(mount);
  }
}
