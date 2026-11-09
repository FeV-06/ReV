import { randomBytes } from 'node:crypto';
import type * as vscode from 'vscode';
import type { Project } from './daemonClient';

export interface WebviewState {
  daemonStatus: 'connected' | 'disconnected' | 'connecting';
  daemonPort?: number;
  workspacePath?: string;
  project?: Project;
  currentRun?: any;
  error?: string;
  loading?: boolean;
  exportSuccess?: string;
}

export function getNonce(): string {
  return randomBytes(16).toString('hex');
}

export function escapeHtml(str: unknown): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderAppHtml(state: WebviewState): string {
  const isConnected = state.daemonStatus === 'connected';
  const statusClass = isConnected ? 'pill-connected' : (state.daemonStatus === 'connecting' ? 'pill-connecting' : 'pill-disconnected');
  const statusText = isConnected ? (`Daemon :${state.daemonPort || '3078'}`) : (state.daemonStatus === 'connecting' ? 'Connecting...' : 'Daemon Offline');

  let html = '';

  // Header
  html += '<div class="header">';
  html += '  <div class="brand">';
  html += '    <span class="brand-title">ReV Handover</span>';
  html += `    <span class="pill ${statusClass}">${statusText}</span>`;
  html += '  </div>';
  html += '  <button class="btn btn-secondary" onclick="postAction(\'CHECK_STATUS\')">Refresh</button>';
  html += '</div>';

  // Notifications / Errors
  if (state.error) {
    html += `<div class="alert alert-error">${escapeHtml(state.error)}</div>`;
  }
  if (state.exportSuccess) {
    html += `<div class="alert alert-success">${escapeHtml(state.exportSuccess)}</div>`;
  }

  // Workspace context
  if (!state.workspacePath) {
    html += '<div class="card">';
    html += '  <div class="card-title">No Workspace Folder Open</div>';
    html += '  <p style="font-size: 12px; opacity: 0.8;">Open a project folder in VS Code to activate ReV handover capture.</p>';
    html += '</div>';
    return html;
  }

  if (!isConnected) {
    html += '<div class="card">';
    html += '  <div class="card-title">Daemon Disconnected</div>';
    html += '  <p style="font-size: 12px; opacity: 0.8; margin-bottom: 12px;">Start the ReV daemon to enable continuous capture and handover generation.</p>';
    html += '  <div class="btn-row">';
    html += '    <button class="btn btn-primary" onclick="postAction(\'START_DAEMON\')">Start Local Daemon</button>';
    html += '    <button class="btn btn-secondary" onclick="postAction(\'CHECK_STATUS\')">Check Again</button>';
    html += '  </div>';
    html += '</div>';
    return html;
  }

  // Project Registration Card
  if (!state.project) {
    html += '<div class="card">';
    html += '  <div class="card-title">Unregistered Workspace</div>';
    html += '  <p style="font-size: 12px; opacity: 0.8; margin-bottom: 10px;">This folder is not yet watched by ReV. Register it to capture changes and generate scoped handovers.</p>';
    html += '  <div class="form-group">';
    html += '    <label class="form-label">Folder Path</label>';
    html += `    <input class="input-text" type="text" value="${escapeHtml(state.workspacePath)}" readonly />`;
    html += '  </div>';
    html += '  <div class="form-group">';
    html += '    <label class="form-label">GitHub Username</label>';
    html += '    <input class="input-text" id="reg-username" type="text" placeholder="e.g. FeV-06" value="FeV-06" />';
    html += '  </div>';
    html += '  <div class="btn-row">';
    html += '    <button class="btn btn-primary" onclick="registerProject()">Register Folder with ReV</button>';
    html += '  </div>';
    html += '</div>';
    return html;
  }

  // Registered Project Overview
  const snapshot = state.project.snapshot;
  const projectBase = state.project.root.split(/[\\/]/).pop() || state.project.root;
  const changesCount = snapshot?.changes ? snapshot.changes.length : (snapshot?.uncommittedCount ?? 0);
  const commitDisplay = snapshot?.commitCount !== undefined ? snapshot.commitCount : (snapshot?.commitId ? snapshot.commitId.slice(0, 7) : 0);
  const fingerprintDisplay = snapshot?.fingerprint ? snapshot.fingerprint.slice(0, 7) : (snapshot?.commitId ? snapshot.commitId.slice(0, 7) : 'sync');

  html += '<div class="card">';
  html += '  <div class="card-title">';
  html += `    <span>Watched Project: ${escapeHtml(projectBase)}</span>`;
  html += `    <span class="pill pill-neutral">${escapeHtml(state.project.githubUsername)}</span>`;
  html += '  </div>';

  html += '  <div class="stats-grid">';
  html += '    <div class="stat-box">';
  html += `      <div class="stat-num">${commitDisplay}</div>`;
  html += '      <div class="stat-label">Commit / Head</div>';
  html += '    </div>';
  html += '    <div class="stat-box">';
  html += `      <div class="stat-num">${changesCount}</div>`;
  html += '      <div class="stat-label">Working Changes</div>';
  html += '    </div>';
  html += '    <div class="stat-box">';
  html += `      <div class="stat-num">${fingerprintDisplay}</div>`;
  html += '      <div class="stat-label">Fingerprint</div>';
  html += '    </div>';
  html += '  </div>';

  html += '  <div class="btn-row">';
  html += '    <button class="btn btn-secondary" onclick="postAction(\'TRIGGER_SCAN\')">Sync & Scan Now</button>';
  html += '    <button class="btn btn-secondary" onclick="postAction(\'OPEN_DASHBOARD\')">Open Dashboard</button>';
  html += '  </div>';
  html += '</div>';

  // Handover Creation / Workbench Card
  html += '<div class="card">';
  html += '  <div class="card-title">Handover Generator</div>';

  if (!state.currentRun) {
    html += '  <div class="form-group">';
    html += '    <label class="form-label">Recipient / Target Title</label>';
    html += '    <input class="input-text" id="target-recipient" type="text" placeholder="e.g. Successor Engineer" value="Successor Engineer" />';
    html += '  </div>';
    html += '  <div class="form-group">';
    html += '    <label class="form-label">Target Role</label>';
    html += '    <select class="select" id="target-role">';
    html += '      <option value="Backend engineer">Backend Engineer</option>';
    html += '      <option value="Full-stack engineer">Full-Stack Engineer</option>';
    html += '      <option value="Staff/lead engineer">Staff / Lead Engineer</option>';
    html += '      <option value="DevOps/SRE engineer">DevOps / SRE Engineer</option>';
    html += '      <option value="QA engineer">QA Engineer</option>';
    html += '    </select>';
    html += '  </div>';
    html += '  <div class="btn-row">';
    html += '    <button class="btn btn-primary" onclick="createHandover()">Generate Handover</button>';
    html += '  </div>';
  } else {
    // Active Handover Review
    const run = state.currentRun;
    html += '  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">';
    html += `    <span style="font-weight:600;">Status: <span class="pill ${run.state === 'approved' ? 'pill-connected' : 'pill-connecting'}">${escapeHtml(run.state)}</span></span>`;
    html += `    <span style="font-size:11px; opacity:0.8;">Role: ${escapeHtml(run.targetRole || 'Engineer')}</span>`;
    html += '  </div>';

    if (run.items && run.items.length > 0) {
      html += '  <div class="item-list">';
      for (const item of run.items) {
        html += '    <div class="item-card">';
        html += '      <div class="item-header">';
        html += `        <span class="item-cat">${escapeHtml(item.category)}</span>`;
        html += `        <span style="font-size:10px; opacity:0.7;">${item.verified ? '✓ Verified' : '⚠ Edited'}</span>`;
        html += '      </div>';
        html += `      <div class="item-body">${escapeHtml(item.text)}</div>`;
        if (item.citations && item.citations.length > 0) {
          html += '      <div class="citations">';
          for (const c of item.citations) {
            html += `        <span class="cite-pill">${escapeHtml(c.sourceKind || 'cite')}:${escapeHtml(c.sourceExternalId || c.sourceId)}</span>`;
          }
          html += '      </div>';
        }
        html += '    </div>';
      }
      html += '  </div>';
    } else {
      html += '  <div class="empty-msg">Synthesized claims will appear here once generated.</div>';
    }

    html += '  <div class="btn-row" style="margin-top:14px;">';
    if (run.state !== 'approved') {
      html += '    <button class="btn btn-primary" onclick="approveHandover()">Approve Handover</button>';
    }
    html += `    <button class="btn btn-secondary" onclick="exportHandover()" ${run.state !== 'approved' ? 'disabled' : ''}>Export HANDOVER.md</button>`;
    html += '    <button class="btn btn-secondary" onclick="postAction(\'RESET_RUN\')">New Handover</button>';
    html += '  </div>';
  }

  html += '</div>';
  return html;
}

export function generateWebviewHtml(webview: vscode.Webview, state: WebviewState): string {
  const nonce = getNonce();
  const serializedState = JSON.stringify(state).replace(/</g, '\\u003c');
  const initialHtml = renderAppHtml(state);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
  <title>ReV Handover</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #d4d4d4);
      --card-bg: var(--vscode-editorWidget-background, #252526);
      --card-border: var(--vscode-editorWidget-border, #333333);
      --primary: var(--vscode-button-background, #007acc);
      --primary-fg: var(--vscode-button-foreground, #ffffff);
      --primary-hover: var(--vscode-button-hoverBackground, #0062a3);
      --secondary: var(--vscode-button-secondaryBackground, #3a3d41);
      --secondary-fg: var(--vscode-button-secondaryForeground, #ffffff);
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --input-border: var(--vscode-input-border, #3c3c3c);
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
      --success: #388a34;
      --warning: #cca700;
      --danger: #e51400;
      --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--font);
      font-size: 13px;
      line-height: 1.5;
      padding: 16px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .brand-title {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.2px;
    }
    .pill {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .pill-connected { background-color: var(--success); color: #fff; }
    .pill-disconnected { background-color: var(--danger); color: #fff; }
    .pill-connecting { background-color: var(--warning); color: #000; }
    .pill-neutral { background-color: var(--badge-bg); color: var(--badge-fg); }

    .card {
      background-color: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 14px;
      margin-bottom: 14px;
    }
    .card-title {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .form-group {
      margin-bottom: 12px;
    }
    .form-label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--fg);
      opacity: 0.85;
    }
    .input-text, .select {
      width: 100%;
      padding: 6px 10px;
      background-color: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      font-family: inherit;
      font-size: 12px;
      outline: none;
    }
    .input-text:focus, .select:focus {
      border-color: var(--primary);
    }

    .btn-row {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px 14px;
      border-radius: 4px;
      border: none;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      transition: background-color 0.15s ease;
    }
    .btn-primary {
      background-color: var(--primary);
      color: var(--primary-fg);
    }
    .btn-primary:hover {
      background-color: var(--primary-hover);
    }
    .btn-secondary {
      background-color: var(--secondary);
      color: var(--secondary-fg);
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin: 10px 0;
    }
    .stat-box {
      background: rgba(128, 128, 128, 0.08);
      border-radius: 4px;
      padding: 8px;
      text-align: center;
    }
    .stat-num {
      font-size: 15px;
      font-weight: 700;
    }
    .stat-label {
      font-size: 10px;
      opacity: 0.75;
      text-transform: uppercase;
    }

    .alert {
      padding: 10px 12px;
      border-radius: 4px;
      font-size: 12px;
      margin-bottom: 12px;
    }
    .alert-error {
      background-color: rgba(229, 20, 0, 0.15);
      border: 1px solid var(--danger);
      color: #ff8080;
    }
    .alert-success {
      background-color: rgba(56, 138, 52, 0.15);
      border: 1px solid var(--success);
      color: #92e08e;
    }

    .item-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 10px;
    }
    .item-card {
      border: 1px solid var(--card-border);
      border-radius: 4px;
      padding: 8px 10px;
      background: rgba(128, 128, 128, 0.04);
    }
    .item-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .item-cat {
      font-size: 10px;
      font-weight: 700;
      color: var(--primary);
      text-transform: uppercase;
    }
    .item-body {
      font-size: 12px;
    }
    .citations {
      margin-top: 6px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .cite-pill {
      font-size: 9px;
      font-family: monospace;
      padding: 1px 6px;
      border-radius: 3px;
      background: rgba(128, 128, 128, 0.2);
    }

    .empty-msg {
      font-style: italic;
      opacity: 0.6;
      font-size: 12px;
      text-align: center;
      padding: 16px 0;
    }
  </style>
</head>
<body>
  <div id="app">${initialHtml}</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let state = ${serializedState};

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function postAction(type, payload = {}) {
      vscode.postMessage({ type, ...payload });
    }

    function registerProject() {
      const usernameInput = document.getElementById('reg-username');
      const githubUsername = usernameInput ? usernameInput.value.trim() : 'FeV-06';
      postAction('REGISTER_WORKSPACE', { githubUsername });
    }

    function createHandover() {
      const recipientInput = document.getElementById('target-recipient');
      const roleSelect = document.getElementById('target-role');
      const recipient = recipientInput ? recipientInput.value.trim() : 'Successor Engineer';
      const targetRole = roleSelect ? roleSelect.value : 'Backend engineer';
      postAction('CREATE_HANDOVER', { recipient, targetRole });
    }

    function approveHandover() {
      postAction('APPROVE_HANDOVER');
    }

    function exportHandover() {
      postAction('EXPORT_HANDOVER');
    }

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'SET_STATE') {
        state = { ...state, ...message.state };
        // Client can re-render if DOM elements need updating
      }
    });
  </script>
</body>
</html>`;
}
