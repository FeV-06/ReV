/**
 * Minimal stand-in webview entry used ONLY when the shared team panel
 * (src/components/team/TeamSyncPanel.tsx) has not landed yet. Renders a
 * placeholder so `pnpm vscode:build` still produces a working VSIX during the
 * transition. The real entry (teamWebviewEntry.tsx) is used once the shared
 * component exists.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';

declare const acquireVsCodeApi: () => { postMessage(message: unknown): void };

export function mountTeamPanelStub(mountElement: HTMLElement): { dispose(): void } {
  const vscode = acquireVsCodeApi();
  const root = createRoot(mountElement);
  root.render(
    React.createElement(
      'div',
      { style: { padding: 16, fontFamily: 'var(--vscode-font-family)', color: 'var(--vscode-foreground)' } },
      React.createElement('h2', null, 'ReV Team Sync'),
      React.createElement(
        'p',
        null,
        'Shared team panel component not built yet (src/components/team/TeamSyncPanel.tsx missing at bundle time).'
      )
    )
  );
  void vscode;
  return {
    dispose() {
      setTimeout(() => root.unmount(), 0);
    },
  };
}

if (typeof document !== 'undefined') {
  const mount = document.getElementById('root');
  if (mount) {
    (window as unknown as Record<string, unknown>).__revTeamPanel = mountTeamPanelStub(mount);
  }
}
