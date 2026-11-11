import path from 'node:path';

export interface TeamPanelHtmlInput {
  /** webview.cspSource from the hosting VS Code webview. */
  cspSource: string;
  /** Fully-qualified webview script URI (asWebviewUri output). */
  scriptUri: string;
  /** Optional stylesheet emitted alongside the webview bundle. */
  styleUri?: string;
  /** Active workspace root injected at boot; never any secret material. */
  workspacePath?: string;
  nonce?: string;
}

export function getTeamNonce(): string {
  // Browser-compatible random nonce (no node:crypto — this module is also
  // bundled into the webview entry for the TEAM_BOOTSTRAP_KEY constant).
  const cryptoRef = (globalThis as { crypto?: { getRandomValues?: (arr: Uint8Array) => Uint8Array } }).crypto;
  const bytes = new Uint8Array(16);
  if (cryptoRef?.getRandomValues) {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function escapeTeamHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderTeamBootstrap(workspacePath?: string): string {
  return JSON.stringify({ workspacePath: workspacePath ?? null }).replace(/</g, '\\u003c');
}

export const TEAM_BOOTSTRAP_KEY = '__REV_TEAM_BOOTSTRAP__';

export function generateTeamPanelHtml(input: TeamPanelHtmlInput): string {
  const nonce = input.nonce ?? getTeamNonce();
  const csp = escapeTeamHtml(input.cspSource);
  const scriptUri = escapeTeamHtml(input.scriptUri);
  const styleTag = input.styleUri
    ? `  <link rel="stylesheet" nonce="${nonce}" href="${escapeTeamHtml(input.styleUri)}">\n`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data:; script-src ${csp} 'nonce-${nonce}'; style-src ${csp} 'unsafe-inline'; font-src ${csp};">
  <title>ReV Team Sync</title>
${styleTag}</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.${TEAM_BOOTSTRAP_KEY} = ${renderTeamBootstrap(input.workspacePath)};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
