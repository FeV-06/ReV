'use client';

/**
 * TeamSyncPanel — client-only panel for authenticated team setup and manual sync.
 *
 * Reusable unchanged in the Next.js web dashboard and the VS Code webview:
 *  - All I/O goes through the injectable `transport` prop (never fetch directly,
 *    never touch window.postMessage itself).
 *  - Secrets flow only through the configure form: the access token lives in a
 *    password-type input, is never persisted (no localStorage/sessionStorage, no
 *    URL, no defaults), never rendered outside the controlled password field,
 *    and is cleared from state on unmount and after a successful apply.
 *  - Every operation is explicit and confirm-gated:
 *      preview  → manual button, read-only, no confirm needed
 *      sync     → requires an explicit "Sync now" press after a successful
 *                 preview (the previewId pin is the confirmation binding);
 *                 `share committed-code analysis` and per-run handover sharing
 *                 default to unchecked; `confirm: true` is set only in the
 *                 sync button handler, never baked into request state
 *      resolve  → explicit per-conflict button press
 *  - Private by default: nothing is shared without an explicit, per-operation
 *    user action; no blanket trust, no standing permission.
 *  - No fabricated state: pending/lastSync/conflicts come only from a validated
 *    backend `status` response. Backend unavailable → the panel says so instead
 *    of guessing. Sync cannot be armed without a fresh, valid preview.
 *  - Runtime-validated: outgoing requests are checked against the contract
 *    (`validateTeamSyncRequest`); incoming responses pass through
 *    `parseTeamSyncResponse`. The panel renders only verified data.
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import './teamSyncPanel.css';
import {
  createHttpTeamSyncTransport,
  parseTeamSyncResponse,
  validateTeamSyncRequest,
  type TeamSyncAction,
  type TeamSyncActionRequest,
  type TeamSyncConflictChoice,
  type TeamSyncPreviewResult,
  type TeamSyncResponse,
  type TeamSyncStatusResult,
  type TeamSyncSyncResult,
  type TeamSyncTransport,
} from './team-client';

// ---------------------------------------------------------------------------
// Props — explicitly marked callbacks and optional-vs-required
// ---------------------------------------------------------------------------

export interface TeamSyncPanelProps {
  /**
   * Injectable transport. The panel calls `request({ action, ...payload })` and
   * trusts only runtime-validated responses. Either `transport` or `endpoint`
   * must be provided; there is no implicit I/O default.
   */
  transport?: TeamSyncTransport;
  /**
   * Optional endpoint (e.g. '/api/team-sync'); if `transport` is omitted, the
   * panel builds an HTTP transport from it. Hosts with no HTTP surface (VS Code)
   * inject a postMessage-backed transport instead.
   */
  endpoint?: string;
  /**
   * Optional active workspace scope the host pins; sent with every request that
   * accepts `projectRoot` and echoed back as `projectRoot` in results. When the
   * host does not provide one, the field stays absent (never guessed).
   */
  activeProjectRoot?: string;
  /** When false, the configure form is hidden (e.g. the host supplies config itself). */
  showConfigureForm?: boolean;
  /** Optional initial non-secret values. No token default exists, by design. */
  initialUrl?: string;
  initialTeamId?: string;
  /** Callbacks — all optional; fired only after a validated, successful action. */
  onConfigure?: (details: { url: string; teamId: string }) => void;
  onSyncComplete?: (result: TeamSyncSyncResult) => void;
  onStatus?: (result: TeamSyncStatusResult) => void;
  /** Fired when preview/status report a stable backend project key. */
  onProjectResolved?: (key: string) => void;
  /** Fired on any failed action, including transport and validation failures. */
  onActionError?: (err: { action: TeamSyncAction; error: string; code?: string }) => void;
  /** Optional className passthrough for host layouts. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TeamSyncPanel(props: TeamSyncPanelProps): React.JSX.Element {
  const {
    transport: transportProp,
    endpoint,
    activeProjectRoot,
    showConfigureForm = true,
    initialUrl = '',
    initialTeamId = '',
    onConfigure,
    onSyncComplete,
    onStatus,
    onProjectResolved,
    onActionError,
    className,
  } = props;

  // --- resolved transport (stable across renders) --------------------------
  const httpTransport = useMemo(
    () => (transportProp || !endpoint ? undefined : createHttpTeamSyncTransport({ endpoint })),
    [transportProp, endpoint],
  );
  const transport = transportProp ?? httpTransport;

  // --- state ---------------------------------------------------------------
  const [form, setForm] = useState({
    url: initialUrl,
    publishableKey: '',
    accessToken: '',
    teamId: initialTeamId,
  });
  const [preview, setPreview] = useState<TeamSyncPreviewResult | null>(null);
  const [status, setStatus] = useState<TeamSyncStatusResult | null>(null);
  const [runChecks, setRunChecks] = useState<Record<string, boolean>>({});
  const [shareAnalysis, setShareAnalysis] = useState(false); // unselected by default
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<TeamSyncAction | null>(null);
  const [confirmLine, setConfirmLine] = useState(false); // explicit per-operation confirmation, unchecked by default
  /**
   * Local projectRoot selection for hosts without a pinned workspace (no VS Code
   * workspace / web dashboard use). Plain text, never a secret, never persisted;
   * ignored entirely when the host pins `activeProjectRoot`.
   */
  const [projectRootInput, setProjectRootInput] = useState('');
  const hostPinnedScope = activeProjectRoot !== undefined;
  const scopeRoot: string | undefined = hostPinnedScope
    ? activeProjectRoot
    : projectRootInput.trim() === ''
      ? undefined
      : projectRootInput.trim();

  const requestSeq = useRef(0);

  // Clear the access token from memory on unmount; it is never persisted.
  const clearToken = useCallback(() => {
    setForm(prev => (prev.accessToken === '' ? prev : { ...prev, accessToken: '' }));
  }, []);

  useEffect(() => {
    return () => clearToken();
  }, [clearToken]);

  // Stable callbacks so effect deps stay simple.
  const statusRef = useRef(onStatus);
  const projectRef = useRef(onProjectResolved);
  useEffect(() => {
    statusRef.current = onStatus;
    projectRef.current = onProjectResolved;
  }, [onStatus, onProjectResolved]);

  // --- core runner -----------------------------------------------------------
  const run = useCallback(
    async <A extends TeamSyncAction>(
      action: A,
      payload: Omit<TeamSyncActionRequest<A>, 'action'>,
    ): Promise<TeamSyncResponse<A> | null> => {
      const seq = ++requestSeq.current;
      setBusyAction(action);
      setError(null);
      setNotice(null);
      const request = { action, ...payload } as TeamSyncActionRequest<A>;
      const check = validateTeamSyncRequest(request);
      if (!check.ok) {
        setError(`Invalid request: ${check.error}`);
        onActionError?.({ action, error: `Invalid request: ${check.error}`, code: 'invalid_request' });
        setBusyAction(null);
        return null;
      }
      if (!transport) {
        const message = 'No transport available: provide the `transport` or `endpoint` prop.';
        setError(message);
        onActionError?.({ action, error: message, code: 'no_transport' });
        setBusyAction(null);
        return null;
      }
      let response: TeamSyncResponse<A>;
      try {
        response = await transport(request);
      } catch (thrown) {
        const message = thrown instanceof Error ? thrown.message : 'Transport failure';
        if (seq === requestSeq.current) {
          setError(`Transport error: ${message}`);
          onActionError?.({ action, error: `Transport error: ${message}`, code: 'transport_error' });
          setBusyAction(null);
        }
        return null;
      }
      if (seq !== requestSeq.current) return null; // superseded; drop stale result
      const parsed = parseTeamSyncResponse(action, response) as TeamSyncResponse<A>;
      if (!parsed.ok) {
        setError(parsed.error);
        onActionError?.({ action, error: parsed.error, code: parsed.code });
        setBusyAction(null);
        return null;
      }
      setBusyAction(null);
      return parsed;
    },
    [transport, onActionError],
  );

  // --- refresh status ---------------------------------------------------------
  const refreshStatus = useCallback(
    async (projectRoot?: string) => {
      const response = await run('status', projectRoot ? { projectRoot } : {});
      if (!response?.ok) return;
      setStatus(response.result);
      statusRef.current?.(response.result);
      if (response.result.projectKey !== null) projectRef.current?.(response.result.projectKey);
    },
    [run],
  );

  // Initial + scope-change status fetch; nothing renders as "known" until this lands.
  useEffect(() => {
    void refreshStatus(scopeRoot);
  }, [refreshStatus, scopeRoot]);

  // --- actions ---------------------------------------------------------------
  const handleConfigure = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const response = await run('configure', {
        url: form.url.trim(),
        publishableKey: form.publishableKey,
        accessToken: form.accessToken,
        teamId: form.teamId.trim(),
      });
      if (!response?.ok) return;
      setNotice('Team backend configured.');
      onConfigure?.({
        url: response.result.url ?? form.url.trim(),
        teamId: response.result.teamId ?? form.teamId.trim(),
      });
      setForm(prev => ({ ...prev, accessToken: '', publishableKey: '' }));
      void refreshStatus(scopeRoot);
    },
    [form, run, onConfigure, refreshStatus, scopeRoot],
  );

  const defaultRunChecks = useCallback((result: TeamSyncPreviewResult): Record<string, boolean> => {
    const checks: Record<string, boolean> = {};
    for (const entry of result.runs) checks[entry.runId] = false; // opt-in: unchecked by default
    return checks;
  }, []);

  const handlePreview = useCallback(async () => {
    const response = await run('preview', scopeRoot ? { projectRoot: scopeRoot } : {});
    if (!response?.ok) return;
    setPreview(response.result);
    setRunChecks(defaultRunChecks(response.result));
  }, [run, scopeRoot, defaultRunChecks]);

  const selectedRunIds = useMemo(
    () => Object.keys(runChecks).filter(runId => runChecks[runId] === true),
    [runChecks],
  );
  const anyRunSelected = selectedRunIds.length > 0;

  const handleSync = useCallback(async () => {
    if (preview === null) {
      const message = 'Run Preview first — sync requires a current preview with exact counts.';
      setError(message);
      onActionError?.({ action: 'sync', error: message, code: 'no_preview' });
      return;
    }
    // confirm: true is set HERE and only here — the explicit "Sync now" press.
    const response = await run('sync', {
      previewId: preview.previewId,
      ...(scopeRoot !== undefined ? { projectRoot: scopeRoot } : {}),
      shareAnalysis,
      sharedRunIds: selectedRunIds,
      confirm: true,
    });
    if (!response?.ok) return;
    setNotice('Sync complete.');
    onSyncComplete?.(response.result);
    setPreview(null);
    setRunChecks({});
    setShareAnalysis(false);
    setConfirmLine(false);
    void refreshStatus(scopeRoot);
  }, [preview, shareAnalysis, selectedRunIds, scopeRoot, run, onActionError, onSyncComplete, refreshStatus]);

  const handleResolve = useCallback(
    async (conflictId: string, choice: TeamSyncConflictChoice) => {
      const response = await run('resolve', {
        conflictId,
        choice,
        ...(scopeRoot !== undefined ? { projectRoot: scopeRoot } : {}),
      });
      if (!response?.ok) return;
      setNotice(`Conflict ${conflictId} resolved (${choice === 'keep_local' ? 'kept local' : 'used incoming'}).`);
      void refreshStatus(scopeRoot);
    },
    [run, scopeRoot, refreshStatus],
  );

  const toggleRun = useCallback((runId: string, checked: boolean) => {
    setRunChecks(prev => ({ ...prev, [runId]: checked }));
  }, []);

  // --- form field ids (accessible label association) -------------------------
  const idBase = useId();
  const urlId = `${idBase}-url`;
  const keyId = `${idBase}-key`;
  const tokenId = `${idBase}-token`;
  const teamIdId = `${idBase}-team`;
  const shareAnalysisId = `${idBase}-share-analysis`;
  const confirmId = `${idBase}-confirm`;
  const scopeRootId = `${idBase}-scope-root`;

  const busy = busyAction !== null;
  const statusUnavailable = status === null && !busy && error !== null;

  return (
    <section className={['team-sync-panel', className ?? ''].filter(Boolean).join(' ')} aria-busy={busy}>
      <header className="tsp-header">
        <h2 className="tsp-title">Team sync</h2>
        <p className="tsp-subtitle">Manual only — nothing leaves this machine without an explicit action.</p>
      </header>

      <div role="status" aria-live="polite" className="tsp-statusline" data-state={busy ? 'busy' : notice ? 'ok' : 'idle'}>
        {busy ? 'Working…' : (notice ?? '')}
      </div>
      {error !== null && (
        <div role="alert" className="tsp-error">
          {error}
        </div>
      )}

      {/* ------------------------------------------------ status card ------- */}
      <div className="tsp-card" data-testid="tsp-status">
        <h3 className="tsp-card-title">Status</h3>
        {status === null ? (
          <p className="tsp-muted" data-testid="tsp-status-unavailable">
            {statusUnavailable
              ? 'Status unavailable — the team backend could not be reached. Nothing is known about pending syncs; press Refresh status to retry.'
              : 'Loading status…'}
          </p>
        ) : (
          <dl className="tsp-statusgrid">
            <dt>Backend</dt>
            <dd>
              {status.configured
                ? `Configured${status.url ? ` — ${status.url}` : ''}`
                : 'Not configured'}
            </dd>
            <dt>Team</dt>
            <dd>{status.teamId ?? '—'}</dd>
            <dt>Project key</dt>
            <dd data-testid="tsp-project-key">{status.projectKey ?? '—'}</dd>
            <dt>Pending</dt>
            <dd>
              {status.pending.outgoingRuns} outgoing run(s), {status.pending.incomingUpdates} incoming update(s),{' '}
              {status.pending.conflicts} conflict(s)
            </dd>
            <dt>Last sync</dt>
            <dd data-testid="tsp-last-sync">
              {status.lastSync === null
                ? 'No sync recorded yet'
                : `${status.lastSync.ok ? 'Succeeded' : 'Failed'} at ${status.lastSync.at}${status.lastSync.detail ? ` — ${status.lastSync.detail}` : ''}`}
            </dd>
          </dl>
        )}
        {status !== null && status.conflicts.length > 0 && (
          <div className="tsp-conflicts" data-testid="tsp-conflicts">
            <h4 className="tsp-card-subtitle">Conflicts</h4>
            <ul className="tsp-conflictlist">
              {status.conflicts.map(conflict => (
                <li key={conflict.conflictId} className="tsp-conflict">
                  <span className="tsp-conflict-summary">{conflict.summary}</span>
                  <span className="tsp-muted">
                    local: {conflict.localLabel ?? '—'} · incoming: {conflict.incomingLabel ?? '—'}
                  </span>
                  {status.capabilities.resolve ? (
                    <span className="tsp-conflict-actions">
                      <button type="button" className="tsp-button" disabled={busy} onClick={() => void handleResolve(conflict.conflictId, 'keep_local')}>
                        Keep local
                      </button>
                      <button type="button" className="tsp-button" disabled={busy} onClick={() => void handleResolve(conflict.conflictId, 'use_incoming')}>
                        Use incoming
                      </button>
                    </span>
                  ) : (
                    <span className="tsp-muted">Resolution not supported by the backend yet.</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="button" className="tsp-button" disabled={busy} onClick={() => void refreshStatus(scopeRoot)}>
          Refresh status
        </button>
      </div>

      {/* -------------------------- local project scope (when host pins none) */}
      {!hostPinnedScope && (
        <div className="tsp-field" data-testid="tsp-scope">
          <label htmlFor={scopeRootId}>Project root (optional)</label>
          <input
            id={scopeRootId}
            name="projectRoot"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. /home/you/projects/rev"
            value={projectRootInput}
            onChange={event => setProjectRootInput(event.target.value)}
          />
          <p className="tsp-muted">
            The local workspace to sync. Leave empty to let the backend use its current scope. This path is a local
            reference only — it is not shared and not stored.
          </p>
        </div>
      )}

      {/* --------------------------------------------- configure form ------- */}
      {showConfigureForm && (
        <form className="tsp-card" onSubmit={event => void handleConfigure(event)} data-testid="tsp-configure">
          <h3 className="tsp-card-title">Team backend</h3>
          <p className="tsp-muted">
            Supabase project URL, publishable (anon) key, and your own session token. The token is kept in memory
            only — never stored, logged, or sent anywhere except to your configured backend during an action.
          </p>
          <div className="tsp-field">
            <label htmlFor={urlId}>Project URL</label>
            <input id={urlId} name="url" type="url" autoComplete="off" spellCheck={false} required placeholder="https://your-project.supabase.co" value={form.url} onChange={event => setForm(prev => ({ ...prev, url: event.target.value }))} />
          </div>
          <div className="tsp-field">
            <label htmlFor={keyId}>Publishable key</label>
            <input id={keyId} name="publishableKey" type="password" autoComplete="off" spellCheck={false} required value={form.publishableKey} onChange={event => setForm(prev => ({ ...prev, publishableKey: event.target.value }))} />
          </div>
          <div className="tsp-field">
            <label htmlFor={tokenId}>Session access token</label>
            <input id={tokenId} name="accessToken" type="password" autoComplete="off" spellCheck={false} required value={form.accessToken} onChange={event => setForm(prev => ({ ...prev, accessToken: event.target.value }))} />
          </div>
          <div className="tsp-field">
            <label htmlFor={teamIdId}>Team ID</label>
            <input id={teamIdId} name="teamId" type="text" autoComplete="off" spellCheck={false} required value={form.teamId} onChange={event => setForm(prev => ({ ...prev, teamId: event.target.value }))} />
          </div>
          <button type="submit" className="tsp-button tsp-button-primary" disabled={busy}>
            Apply configuration
          </button>
        </form>
      )}

      {/* -------------------------------------------------- preview --------- */}
      <div className="tsp-card" data-testid="tsp-preview">
        <h3 className="tsp-card-title">Manual sync</h3>
        <p className="tsp-muted">
          Preview shows exactly what would be shared — counts, files, and excerpts — before anything is sent. Sync
          applies only the checked items after you press Sync now.
        </p>
        <button type="button" className="tsp-button" disabled={busy} onClick={() => void handlePreview()}>
          Preview
        </button>

        {preview !== null && (
          <>
            <h4 className="tsp-card-subtitle">What would be shared</h4>
            <dl className="tsp-statusgrid" data-testid="tsp-preview-counts">
              <dt>Runs</dt>
              <dd>
                {preview.counts.runs} total, {preview.counts.eligibleRuns} eligible, {preview.counts.incomingRuns} incoming
              </dd>
              <dt>Items</dt>
              <dd>
                {preview.counts.items} local, {preview.counts.incomingItems} incoming
              </dd>
              <dt>Artifacts</dt>
              <dd>{preview.counts.artifacts}</dd>
              <dt>Flagged files</dt>
              <dd className={preview.counts.sensitivePaths > 0 ? 'tsp-warning-text' : undefined}>
                {preview.counts.sensitivePaths} potentially sensitive
              </dd>
            </dl>

            {preview.manifest.length > 0 && (
              <table className="tsp-table">
                <caption className="tsp-muted">Content manifest — paths and excerpts marked by the backend scan</caption>
                <thead>
                  <tr>
                    <th scope="col">Path</th>
                    <th scope="col">Excerpt</th>
                    <th scope="col">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.manifest.map(entry => (
                    <tr key={entry.path} data-sensitive={entry.sensitive || undefined}>
                      <td className="tsp-monospace">{entry.path}</td>
                      <td>{entry.excerpt ?? '(excerpt withheld)'}</td>
                      <td>{entry.sensitive ? `Sensitive${entry.reason ? ` — ${entry.reason}` : ''}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {preview.warnings.length > 0 && (
              <div className="tsp-warning" role="note">
                <ul>
                  {preview.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <h4 className="tsp-card-subtitle">Runs eligible to share</h4>
            <p className="tsp-muted" data-testid="tsp-eligibility-note">
              Only approved handovers, and drafts in needs_review with explicitly authorized, scope-confirmed sources,
              can be shared. Drafts without confirmed scope are never eligible. Eligibility is decided by the backend
              from each run&apos;s review state — the panel does not widen it.
            </p>
            {preview.runs.length === 0 ? (
              <p className="tsp-muted">No runs available for this project.</p>
            ) : (
              <ul className="tsp-runlist" data-testid="tsp-runlist">
                {preview.runs.map(entry => (
                  <li key={entry.runId}>
                    {entry.eligible ? (
                      <label className="tsp-check">
                        <input type="checkbox" checked={runChecks[entry.runId] === true} onChange={event => toggleRun(entry.runId, event.target.checked)} />
                        <span>
                          {entry.label ?? entry.runId} — {entry.itemCount} item(s)
                        </span>
                      </label>
                    ) : (
                      <span className="tsp-muted" title={entry.ineligibleReason ?? undefined}>
                        {entry.label ?? entry.runId} — not eligible{entry.ineligibleReason ? `: ${entry.ineligibleReason}` : ''}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="tsp-field">
              <label className="tsp-check" htmlFor={shareAnalysisId}>
                <input id={shareAnalysisId} type="checkbox" checked={shareAnalysis} onChange={event => setShareAnalysis(event.target.checked)} />
                <span>Share committed-code analysis</span>
              </label>
            </div>

            <div className="tsp-field">
              <label className="tsp-check" htmlFor={confirmId}>
                <input id={confirmId} type="checkbox" checked={confirmLine} onChange={event => setConfirmLine(event.target.checked)} />
                <span>I confirm I want to share exactly the items selected above.</span>
              </label>
            </div>

            <button type="button" className="tsp-button tsp-button-primary" disabled={busy || !confirmLine} data-testid="tsp-sync-now" onClick={() => void handleSync()}>
              Sync now
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export default TeamSyncPanel;
