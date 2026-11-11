import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal hoisted VS Code mock (only what extension.ts touches at import time)
// ---------------------------------------------------------------------------
const { mockVsCode } = vi.hoisted(() => {
  const mockVsCode = {
    window: {
      createStatusBarItem: vi.fn(() => ({
        text: '',
        tooltip: '',
        command: '',
        backgroundColor: undefined,
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
      })),
      createWebviewPanel: vi.fn(),
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
      withProgress: vi.fn((_opts: unknown, task: (p: unknown) => unknown) => task({ report: vi.fn() })),
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/home/fev/projects/alpha' } }],
      onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
      fs: { writeFile: vi.fn() },
      openTextDocument: vi.fn(),
    },
    commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })) },
    env: { openExternal: vi.fn() },
    Uri: {
      file: (p: string) => ({ fsPath: p, scheme: 'file', toString: () => `file://${p}` }),
      parse: (url: string) => ({ toString: () => url, scheme: 'http' }),
    },
    StatusBarAlignment: { Right: 2 },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    ThemeColor: class {
      constructor(public id: string) {}
    },
  };
  return { mockVsCode };
});

vi.mock('vscode', () => mockVsCode);

import { RevExtensionManager } from '../editors/vscode/src/extension';
import {
  describeTeamRoute,
  handleTeamRequest,
  parseTeamPayload,
  stripSecretFields,
  type TeamRequestHandlerDeps,
} from '../editors/vscode/src/team/teamHost';
import {
  TEAM_BOOTSTRAP_KEY,
  escapeTeamHtml,
  generateTeamPanelHtml,
  getTeamNonce,
  renderTeamBootstrap,
} from '../editors/vscode/src/team/teamPanelHtml';
import { TeamWebviewController } from '../editors/vscode/src/team/teamWebviewController';
import { createWebviewTeamTransport } from '../editors/vscode/src/team/webviewTransport';
import type { TeamRequestMessage, TeamResponseMessage } from '../editors/vscode/src/team/types';

const WORKSPACE = '/home/fev/projects/alpha';

function makeDeps(overrides: Partial<TeamRequestHandlerDeps> = {}): { deps: TeamRequestHandlerDeps; daemon: ReturnType<typeof vi.fn> } {
  const daemon = vi.fn().mockResolvedValue({ ok: true, action: 'status', result: { configured: false } });
  const deps: TeamRequestHandlerDeps = {
    callDaemon: daemon as unknown as TeamRequestHandlerDeps['callDaemon'],
    getWorkspacePath: () => WORKSPACE,
    ...overrides,
  };
  return { deps, daemon };
}

function makeFakeWebview() {
  const messageHandlers: ((msg: unknown) => void)[] = [];
  const disposeHandlers: (() => void)[] = [];
  const postMessage = vi.fn().mockResolvedValue(true);
  const webview = {
    cspSource: 'vscode-webview:',
    postMessage,
    onDidReceiveMessage: vi.fn((cb: (msg: unknown) => void) => {
      messageHandlers.push(cb);
      return { dispose: () => messageHandlers.splice(messageHandlers.indexOf(cb), 1) };
    }),
    onDidDispose: vi.fn((cb: () => void) => {
      disposeHandlers.push(cb);
      return { dispose: () => disposeHandlers.splice(disposeHandlers.indexOf(cb), 1) };
    }),
    asWebviewUri: vi.fn((uri: { fsPath: string }) => `https://webview.internal${uri.fsPath}`),
  };
  return {
    webview,
    postMessage,
    disposeHandlers,
    emit(msg: unknown) {
      for (const cb of [...messageHandlers]) cb(msg);
    },
    disposeWebview() {
      for (const cb of [...disposeHandlers]) cb();
    },
    handlerCount: () => messageHandlers.length,
  };
}

// ---------------------------------------------------------------------------
// Host-side request handling
// ---------------------------------------------------------------------------
describe('team host request handling (workspace isolation)', () => {
  it('builds the single finalized daemon call: POST /v1/team-sync with {action, payload}', async () => {
    const { deps, daemon } = makeDeps();
    const message: TeamRequestMessage = {
      type: 'TEAM_REQUEST',
      id: 'rev-team-1-aaaaaaaa',
      action: 'status',
      payload: {},
    };
    const response = (await handleTeamRequest(deps, message)) as TeamResponseMessage;

    expect(daemon).toHaveBeenCalledTimes(1);
    const [route, options] = daemon.mock.calls[0];
    expect(route).toBe('/v1/team-sync');
    expect(options.method).toBe('POST');
    expect(options.body).toEqual({ action: 'status', payload: { projectRoot: WORKSPACE } });
    expect(options.workspaceRoot).toBe(WORKSPACE);
    expect(response.ok).toBe(true);
    expect(response.id).toBe('rev-team-1-aaaaaaaa');
    expect(response.result).toEqual({ configured: false });
  });

  it('unwraps daemon action envelopes and relays the payload as-is', async () => {
    const { deps, daemon } = makeDeps();
    daemon.mockResolvedValue({ ok: true, action: 'preview', result: { previewId: 'p-1' } });
    const response = (await handleTeamRequest(deps, {
      type: 'TEAM_REQUEST',
      id: 'rev-team-2-bbbbbbbb',
      action: 'preview',
      payload: {},
    })) as TeamResponseMessage;
    expect(response.ok).toBe(true);
    expect(response.result).toEqual({ previewId: 'p-1' });
    expect(daemon.mock.calls[0][1].body.action).toBe('preview');
  });

  it('rejects invalid, short, and over-long correlation ids', async () => {
    const { deps, daemon } = makeDeps();
    for (const id of [undefined, 42, 'short', 'has spaces!!', 'x'.repeat(65)]) {
      const response = (await handleTeamRequest(deps, { type: 'TEAM_REQUEST', id, action: 'status' })) as TeamResponseMessage;
      expect(response.ok).toBe(false);
      expect(response.error).toContain('invalid correlation id');
      expect(daemon).not.toHaveBeenCalled();
    }
  });

  it('allows only the documented action allowlist', async () => {
    const { deps, daemon } = makeDeps();
    const response = (await handleTeamRequest(deps, {
      type: 'TEAM_REQUEST',
      id: 'rev-team-3-cccccccc',
      action: 'DROP TABLE users',
    })) as TeamResponseMessage;
    expect(response.ok).toBe(false);
    expect(response.error).toContain('unknown action');
    expect(daemon).not.toHaveBeenCalled();
  });

  it('rejects webview-supplied projectRoot that mismatches the active workspace', async () => {
    const { deps, daemon } = makeDeps();
    const response = (await handleTeamRequest(deps, {
      type: 'TEAM_REQUEST',
      id: 'rev-team-4-dddddddd',
      action: 'sync',
      payload: {
        previewId: '8f0c1b2a-1111-4222-8333-444455556666',
        shareAnalysis: false,
        sharedRunIds: [],
        confirm: true,
        projectRoot: '/home/fev/projects/OTHER',
      },
    })) as TeamResponseMessage;
    expect(response.ok).toBe(false);
    expect(response.error).toContain('does not match the active workspace');
    expect(daemon).not.toHaveBeenCalled();
  });

  it('accepts a webview-supplied projectRoot equal to the active workspace', async () => {
    const { deps, daemon } = makeDeps();
    const response = (await handleTeamRequest(deps, {
      type: 'TEAM_REQUEST',
      id: 'rev-team-5-eeeeeeee',
      action: 'preview',
      payload: { projectRoot: WORKSPACE },
    })) as TeamResponseMessage;
    expect(response.ok).toBe(true);
    expect(daemon.mock.calls[0][1].body.payload.projectRoot).toBe(WORKSPACE);
  });

  it('rejects project-scoped actions when no workspace folder is open', async () => {
    const { deps, daemon } = makeDeps({ getWorkspacePath: () => undefined });
    for (const action of ['status', 'preview', 'sync', 'resolve'] as const) {
      const response = (await handleTeamRequest(deps, {
        type: 'TEAM_REQUEST',
        id: 'rev-team-6-ffffffff',
        action,
      })) as TeamResponseMessage;
      expect(response.ok).toBe(false);
      expect(response.error).toContain('no active workspace folder');
    }
    // configure is host-scoped, not project-scoped: allowed without a workspace
    daemon.mockResolvedValue({ ok: true, action: 'configure', result: { configured: true } });
    const ok = (await handleTeamRequest(deps, {
      type: 'TEAM_REQUEST',
      id: 'rev-team-7-99999999',
      action: 'configure',
      payload: { url: 'https://x.supabase.co', publishableKey: 'pk', accessToken: 'tok', teamId: 't' },
    })) as TeamResponseMessage;
    expect(ok.ok).toBe(true);
  });

  it('strips webview-supplied projectRoot from configure payloads', async () => {
    const { deps, daemon } = makeDeps();
    await handleTeamRequest(deps, {
      type: 'TEAM_REQUEST',
      id: 'rev-team-8-aaaaaaaa',
      action: 'configure',
      payload: {
        url: 'https://x.supabase.co',
        publishableKey: 'pk',
        accessToken: 'tok',
        teamId: 't',
        projectRoot: WORKSPACE,
      },
    });
    const body = daemon.mock.calls[0][1].body;
    expect(body.action).toBe('configure');
    expect(body.payload).not.toHaveProperty('projectRoot');
  });

  it('rejects non-object and oversized payloads before touching the daemon', async () => {
    const { deps, daemon } = makeDeps();
    for (const payload of ['string', 5, ['array'], () => {}]) {
      const response = (await handleTeamRequest(deps, {
        type: 'TEAM_REQUEST',
        id: 'rev-team-9-bbbbbbbb',
        action: 'status',
        payload,
      })) as TeamResponseMessage;
      expect(response.ok).toBe(false);
    }
    const huge = 'x'.repeat(64 * 1024 + 1);
    const response = (await handleTeamRequest(deps, {
      type: 'TEAM_REQUEST',
      id: 'rev-team-9-cccccccc',
      action: 'status',
      payload: { huge },
    })) as TeamResponseMessage;
    expect(response.ok).toBe(false);
    expect(response.error).toContain('exceeds');
    expect(daemon).not.toHaveBeenCalled();
  });

  it('never relays secret-like keys from daemon results into the webview', async () => {
    const { deps } = makeDeps();
    const leaked: Record<string, unknown> = {
      configured: true,
      accessToken: 'should-not-leak',
      nested: { access_token: 'also-no', safe: 'yes' },
      list: [{ refreshToken: 'nope', ok: 1 }],
    };
    const depsLeak: TeamRequestHandlerDeps = {
      ...deps,
      callDaemon: vi.fn().mockResolvedValue({ ok: true, action: 'status', result: leaked }),
    };
    const response = (await handleTeamRequest(depsLeak, {
      type: 'TEAM_REQUEST',
      id: 'rev-team-10-dddddddd',
      action: 'status',
    })) as TeamResponseMessage;
    expect(JSON.stringify(response)).not.toContain('should-not-leak');
    expect(JSON.stringify(response)).not.toContain('also-no');
    expect(JSON.stringify(response)).not.toContain('nope');
    expect(response.result).toMatchObject({ configured: true, nested: { safe: 'yes' } });
  });

  it('converts daemon {ok:false} envelopes and thrown errors into error responses', async () => {
    const { deps, daemon } = makeDeps();
    daemon.mockResolvedValue({ ok: false, action: 'sync', error: 'backend rejected the sync' });
    const bad = (await handleTeamRequest(deps, {
      type: 'TEAM_REQUEST',
      id: 'rev-team-11-eeeeeeee',
      action: 'sync',
      payload: { previewId: '8f0c1b2a-1111-4222-8333-444455556666', shareAnalysis: false, sharedRunIds: [], confirm: true },
    })) as TeamResponseMessage;
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('backend rejected the sync');

    daemon.mockRejectedValue(new Error('ECONNREFUSED'));
    const thrown = (await handleTeamRequest(deps, {
      type: 'TEAM_REQUEST',
      id: 'rev-team-12-ffffffff',
      action: 'status',
    })) as TeamResponseMessage;
    expect(thrown.ok).toBe(false);
    expect(thrown.error).toBe('ECONNREFUSED');
  });
});

// ---------------------------------------------------------------------------
// Route planner unit checks
// ---------------------------------------------------------------------------
describe('describeTeamRoute', () => {
  it('always targets the single /v1/team-sync POST endpoint', () => {
    for (const action of ['status', 'configure', 'preview', 'sync', 'resolve'] as const) {
      const plan = describeTeamRoute(action, WORKSPACE, {});
      expect(plan.route).toBe('/v1/team-sync');
      expect(plan.method).toBe('POST');
      expect(plan.body.action).toBe(action);
      expect(plan.body.payload).toBeTypeOf('object');
    }
  });

  it('pins projectRoot only on project-scoped actions', () => {
    expect(describeTeamRoute('status', WORKSPACE, {}).body.payload).toEqual({ projectRoot: WORKSPACE });
    expect(describeTeamRoute('configure', WORKSPACE, {}).body.payload).toEqual({});
    expect(describeTeamRoute('configure', WORKSPACE, { projectRoot: '/elsewhere' }).body.payload).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Payload + secret utilities
// ---------------------------------------------------------------------------
describe('payload parsing and secret stripping', () => {
  it('parses plain JSON objects with a size ceiling', () => {
    expect(parseTeamPayload(undefined)).toEqual({ ok: true, value: {} });
    expect(parseTeamPayload({ a: 1 })).toMatchObject({ ok: true });
    expect(parseTeamPayload('nope').ok).toBe(false);
    expect(parseTeamPayload({ big: 'x'.repeat(64 * 1024 + 1) }).ok).toBe(false);
  });

  it('strips credential-shaped keys at any depth', () => {
    const out = stripSecretFields({
      a: { accessToken: 'x', b: [{ publishable_key: 'y' }] },
      access_token: 'z',
      keep: 'me',
    });
    expect(out).toEqual({ a: { b: [{}] }, keep: 'me' });
  });
});

// ---------------------------------------------------------------------------
// Webview-side transport
// ---------------------------------------------------------------------------
describe('webview team transport (browser side)', () => {
  type Target = {
    listeners: ((ev: { data?: unknown }) => void)[];
    addEventListener: (type: string, cb: (ev: { data?: unknown }) => void) => void;
    removeEventListener: (type: string, cb: (ev: { data?: unknown }) => void) => void;
  };
  function makeTarget(): Target {
    const listeners: ((ev: { data?: unknown }) => void)[] = [];
    return {
      listeners,
      addEventListener: (_t, cb) => listeners.push(cb),
      removeEventListener: (_t, cb) => listeners.splice(listeners.indexOf(cb), 1),
    };
  }

  it('posts a bounded TEAM_REQUEST and resolves the typed envelope on response', async () => {
    const target = makeTarget();
    const posted: unknown[] = [];
    const transport = createWebviewTeamTransport(
      { postMessage: (m: unknown) => posted.push(m) },
      { eventTarget: target }
    );

    const pending = transport({ action: 'status', projectRoot: WORKSPACE });
    expect(posted).toHaveLength(1);
    const msg = posted[0] as TeamRequestMessage;
    expect(msg.type).toBe('TEAM_REQUEST');
    expect(msg.action).toBe('status');
    expect(msg.payload).toEqual({ action: 'status', projectRoot: WORKSPACE });
    expect(msg.id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);

    for (const cb of target.listeners) cb({ data: { type: 'TEAM_RESPONSE', id: msg.id, ok: true, result: { configured: false } } });
    const envelope = await pending;
    expect(envelope).toEqual({ ok: true, action: 'status', result: { configured: false } });
    expect(transport.pendingCount()).toBe(0);
  });

  it('maps ok:false host responses to error envelopes with the host message', async () => {
    const target = makeTarget();
    const transport = createWebviewTeamTransport({ postMessage: () => undefined }, { eventTarget: target });
    const pending = transport({ action: 'configure', url: 'https://x', publishableKey: 'k', accessToken: 't', teamId: 'id' });
    const postedId = 'irrelevant';
    void postedId;
    // Extract the id from the actual postMessage the transport produced via a spy bridge
    const captured: TeamRequestMessage[] = [];
    const transport2 = createWebviewTeamTransport(
      { postMessage: (m: unknown) => captured.push(m as TeamRequestMessage) },
      { eventTarget: target }
    );
    void transport2;
    // Respond to the first transport's request
    const first = captured.length; // 0 for first transport (separate bridge)
    void first;
    // Rebuild cleanly: single transport with capture bridge
    const messages: TeamRequestMessage[] = [];
    const t = createWebviewTeamTransport(
      { postMessage: (m: unknown) => messages.push(m as TeamRequestMessage) },
      { eventTarget: target }
    );
    const p = t({ action: 'sync', previewId: '8f0c1b2a-1111-4222-8333-444455556666', shareAnalysis: false, sharedRunIds: [], confirm: true });
    for (const cb of target.listeners)
      cb({ data: { type: 'TEAM_RESPONSE', id: messages[0].id, ok: false, error: 'no fresh preview' } });
    const envelope = await p;
    expect(envelope).toEqual({ ok: false, action: 'sync', error: 'no fresh preview' });
    void pending;
  });

  it('resolves error envelopes for responses with missing error text', async () => {
    const target = makeTarget();
    const messages: TeamRequestMessage[] = [];
    const t = createWebviewTeamTransport(
      { postMessage: (m: unknown) => messages.push(m as TeamRequestMessage) },
      { eventTarget: target }
    );
    const p = t({ action: 'status' });
    for (const cb of target.listeners) cb({ data: { type: 'TEAM_RESPONSE', id: messages[0].id, ok: false } });
    expect(await p).toEqual({ ok: false, action: 'status', error: 'team request failed' });
  });

  it('times out requests with an error envelope (no hang, no throw)', async () => {
    const target = makeTarget();
    const t = createWebviewTeamTransport({ postMessage: () => undefined }, { eventTarget: target, timeoutMs: 20 });
    const envelope = await t({ action: 'status' });
    expect(envelope).toMatchObject({ ok: false, action: 'status' });
    expect((envelope as { error: string }).error).toContain('timed out');
    expect(t.pendingCount()).toBe(0);
  });

  it('rejects unknown actions locally without posting to the host', async () => {
    const target = makeTarget();
    const posted: unknown[] = [];
    const t = createWebviewTeamTransport({ postMessage: (m: unknown) => posted.push(m) }, { eventTarget: target });
    const envelope = await t({ action: 'evil' as never });
    expect(envelope.ok).toBe(false);
    expect(posted).toHaveLength(0);
  });

  it('dispose() settles pending requests and detaches the listener', async () => {
    const target = makeTarget();
    const t = createWebviewTeamTransport({ postMessage: () => undefined }, { eventTarget: target });
    const pending = t({ action: 'status' });
    expect(t.pendingCount()).toBe(1);
    t.dispose();
    const envelope = await pending;
    expect(envelope.ok).toBe(false);
    expect(t.pendingCount()).toBe(0);
    expect(target.listeners).toHaveLength(0);
    const after = await t({ action: 'status' });
    expect(after.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Team panel HTML + CSP
// ---------------------------------------------------------------------------
describe('team panel HTML generation', () => {
  it('emits a nonce-CSP shell with webview URIs and workspace bootstrap only', () => {
    const html = generateTeamPanelHtml({
      cspSource: 'vscode-webview:',
      scriptUri: 'https://webview.internal/dist/teamWebview.js',
      styleUri: 'https://webview.internal/dist/teamWebview.css',
      workspacePath: '/home/fev/projects/alpha',
    });
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src vscode-webview: 'nonce-");
    expect(html).toContain('src="https://webview.internal/dist/teamWebview.js"');
    expect(html).toContain('rel="stylesheet"');
    expect(html).toContain(TEAM_BOOTSTRAP_KEY);
    expect(html).toContain('/home/fev/projects/alpha');
    // The bootstrap carries the workspace path and nothing else.
    const bootstrapMatch = html.match(new RegExp(`${TEAM_BOOTSTRAP_KEY} = (\\{[^<]*\\})`));
    expect(bootstrapMatch).not.toBeNull();
    expect(Object.keys(JSON.parse(bootstrapMatch![1] as string))).toEqual(['workspacePath']);
  });

  it('escapes injected strings and generates unique nonces per render', () => {
    const html = generateTeamPanelHtml({
      cspSource: 'vscode-webview:',
      scriptUri: 'https://evil.example/x" onload="alert(1)',
    });
    expect(html).not.toContain('onload="alert(1)"');
    expect(escapeTeamHtml('<b>&"\'</b>')).toBe('&lt;b&gt;&amp;&quot;&#039;&lt;/b&gt;');
    expect(getTeamNonce()).not.toBe(getTeamNonce());
    expect(getTeamNonce()).toMatch(/^[0-9a-f]{32}$/);
    expect(renderTeamBootstrap('/w<s>')).not.toContain('/w<s>');
  });
});

// ---------------------------------------------------------------------------
// Controller + extension lifecycle (workspace isolation)
// ---------------------------------------------------------------------------
describe('TeamWebviewController message bridge and disposal', () => {
  it('routes TEAM_REQUEST messages to the daemon and posts correlated responses', async () => {
    const fake = makeFakeWebview();
    const { deps, daemon } = makeDeps();
    const controller = new TeamWebviewController(deps, fake.webview as never, { workspacePath: WORKSPACE });

    fake.emit({ type: 'TEAM_REQUEST', id: 'rev-team-20-aaaaaaaa', action: 'status' });
    await vi.waitFor(() => expect(fake.postMessage).toHaveBeenCalled());
    const response = fake.postMessage.mock.calls[0][0] as TeamResponseMessage;
    expect(response.type).toBe('TEAM_RESPONSE');
    expect(response.id).toBe('rev-team-20-aaaaaaaa');
    expect(response.ok).toBe(true);
    expect(daemon.mock.calls[0][1].body.payload.projectRoot).toBe(WORKSPACE);

    // Non-team messages are ignored (legacy handover panel keeps its own handler)
    fake.postMessage.mockClear();
    fake.emit({ type: 'CHECK_STATUS' });
    fake.emit(null);
    fake.emit('string');
    expect(fake.postMessage).not.toHaveBeenCalled();

    controller.dispose();
    expect(fake.handlerCount()).toBe(0);
  });

  it('ignores messages after disposal and detaches on webview dispose', async () => {
    const fake = makeFakeWebview();
    const { deps, daemon } = makeDeps();
    const controller = new TeamWebviewController(deps, fake.webview as never, { workspacePath: WORKSPACE });

    fake.disposeWebview(); // webview went away first
    fake.emit({ type: 'TEAM_REQUEST', id: 'rev-team-21-bbbbbbbb', action: 'status' });
    expect(daemon).not.toHaveBeenCalled();
    controller.dispose(); // idempotent
    expect(fake.handlerCount()).toBe(0);
  });
});

describe('RevExtensionManager team panel lifecycle (workspace isolation)', () => {
  let context: { subscriptions: unknown[]; extensionUri: { fsPath: string } };
  let client: { request: ReturnType<typeof vi.fn> };
  const panels: ReturnType<typeof makeFakeWebview>[] = [];

  function makePanel(fake: ReturnType<typeof makeFakeWebview>) {
    return {
      webview: fake.webview,
      reveal: vi.fn(),
      dispose: vi.fn(() => fake.disposeWebview()),
      onDidDispose: vi.fn((cb: () => void) => {
        fake.disposeHandlers.push(cb);
        return { dispose: () => undefined };
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    panels.length = 0;
    mockVsCode.workspace.workspaceFolders = [{ uri: { fsPath: WORKSPACE } }];
    mockVsCode.window.createWebviewPanel.mockImplementation(() => {
      const fake = makeFakeWebview();
      panels.push(fake);
      return makePanel(fake);
    });
    client = {
      request: vi.fn().mockResolvedValue({ ok: true, action: 'status', result: { configured: false } }),
    };
    context = { subscriptions: [], extensionUri: { fsPath: '/extension' } };
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('opens the team panel with webview-URI assets, CSP html, and host-side daemon calls', async () => {
    const manager = new RevExtensionManager(context as never, client as never);
    await manager.openTeamPanel();

    expect(mockVsCode.window.createWebviewPanel).toHaveBeenCalledWith(
      'revTeamSync',
      'ReV Team Sync',
      expect.anything(),
      expect.objectContaining({ enableScripts: true, localResourceRoots: expect.any(Array) })
    );
    const fake = panels[0];
    const html = fake.webview.html as string;
    expect(html).toContain('https://webview.internal/extension/dist/teamWebview.js');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain(WORKSPACE);
    // No token material ever reaches the webview HTML
    expect(html).not.toMatch(/token|secret/i);

    // Message round trip: webview TEAM_REQUEST -> host daemon call -> response
    fake.emit({ type: 'TEAM_REQUEST', id: 'rev-team-30-cccccccc', action: 'status' });
    await vi.waitFor(() => expect(client.request).toHaveBeenCalled());
    await vi.waitFor(() => expect(fake.postMessage).toHaveBeenCalled());
    expect(client.request.mock.calls[0][0]).toBe('/v1/team-sync');
    const response = fake.postMessage.mock.calls[0][0] as TeamResponseMessage;
    expect(response.id).toBe('rev-team-30-cccccccc');
    expect(response.ok).toBe(true);

    // Reveal on second open instead of a second panel
    await manager.openTeamPanel();
    expect(mockVsCode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it('disposes the team panel and clears pending state on workspace switch', async () => {
    const manager = new RevExtensionManager(context as never, client as never);
    manager.watchWorkspaceSwitches();
    await manager.openTeamPanel();
    const firstFake = panels[0];

    // Simulate the workspace switching to a different folder
    mockVsCode.workspace.workspaceFolders = [{ uri: { fsPath: '/home/fev/projects/beta' } }];
    const switchCallback = mockVsCode.workspace.onDidChangeWorkspaceFolders.mock.calls.at(-1)?.[0] as () => void;
    switchCallback();

    expect(firstFake.handlerCount()).toBe(0); // message subscriptions cleared
    // A stale TEAM_REQUEST from the old webview no longer reaches the daemon
    client.request.mockClear();
    firstFake.emit({ type: 'TEAM_REQUEST', id: 'rev-team-31-dddddddd', action: 'status' });
    expect(client.request).not.toHaveBeenCalled();

    // Reopening builds a fresh panel pinned to the new workspace root
    await manager.openTeamPanel();
    expect(mockVsCode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    const html = panels[panels.length - 1].webview.html as string;
    expect(html).toContain('/home/fev/projects/beta');
    expect(html).not.toContain('/home/fev/projects/alpha');
  });

  it('keeps legacy handover functionality intact (status, scan, messages)', async () => {
    const manager = new RevExtensionManager(context as never, client as never);
    manager.handleWebviewMessage({ type: 'CHECK_STATUS' });
    await vi.waitFor(() => expect(manager.getActiveWorkspacePath()).toBe(WORKSPACE));
    expect(manager.getActiveWorkspacePath()).toBe(WORKSPACE);
  });
});
