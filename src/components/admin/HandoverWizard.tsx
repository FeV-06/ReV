'use client';

import React, { useEffect, useState } from 'react';
import { dayOneItems, generationFailurePrefix, sourceWarnings, suggestedAreas } from '@/lib/handover';
import { successorEmailSchema, type Item, type Run } from '@/lib/contracts';
import ContributorField from '@/components/ContributorField';
import DepartureInterview from '@/components/DepartureInterview';
import ProjectDashboard from '@/components/ProjectDashboard';

type RunSummary = Pick<Run, 'id' | 'createdAt' | 'recipient' | 'state'>;

async function api(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Rev-Request': '1', ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

interface HandoverWizardProps {
  onBackToProjects?: () => void;
  onSelectRunForDetail?: (run: Run) => void;
}

export default function HandoverWizard({ onBackToProjects, onSelectRunForDetail }: HandoverWizardProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [recipient, setRecipient] = useState('Incoming engineer');
  const [departingPerson, setDepartingPerson] = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [takeoverScope, setTakeoverScope] = useState('');
  const [repo, setRepo] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [authorised, setAuthorised] = useState(false);
  const [remote, setRemote] = useState(false);
  const [partial, setPartial] = useState(false);
  const [sources, setSources] = useState<{ localGit: string | null; gitAuthors: string[]; slack: boolean }>({
    localGit: null,
    gitAuthors: [],
    slack: false,
  });
  const [useGit, setUseGit] = useState(true);
  const [useSlack, setUseSlack] = useState(false);
  const [slack, setSlack] = useState<{ workspace: string | null; workspaceId?: string; channels: { id: string; name: string }[] }>({
    workspace: null,
    channels: [],
  });
  const [slackIds, setSlackIds] = useState<string[]>([]);
  const [slackError, setSlackError] = useState('');
  const [slackBusy, setSlackBusy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shareAnswers, setShareAnswers] = useState<string[]>([]);
  function toggleShare(id: string) {
    setShareAnswers(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  }
  const [error, setError] = useState('');
  const [successorEmail, setSuccessorEmail] = useState('');
  const [showSuccessor, setShowSuccessor] = useState(false);
  const [publishedNotice, setPublishedNotice] = useState('');
  const [exportedMarkdown, setExportedMarkdown] = useState<string | null>(null);
  // Local-only is the default; cloud sync is an explicit, per-submission opt-in.
  const [syncTarget, setSyncTarget] = useState<'cloud' | 'local'>('local');
  const [syncingCloud, setSyncingCloud] = useState(false);
  const [hasSupabaseConfigured, setHasSupabaseConfigured] = useState(false);
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({});
  const [graphEdges, setGraphEdges] = useState<Array<{ id: string; type: string; status: string; fromId: string; toId: string }> | null>(null);

  useEffect(() => {
    async function checkSupabase() {
      try {
        const res = await fetch('/api/settings', { headers: { 'X-Rev-Request': '1' } });
        if (res.ok) {
          const data = await res.json();
          if (data.hasSupabaseConfigured) {
            setHasSupabaseConfigured(true);
            return;
          }
        }
      } catch {}

      try {
        const saved = localStorage.getItem('rev_system_settings');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.postgresUri?.trim()) {
            setHasSupabaseConfigured(true);
          }
        }
      } catch {}
    }
    void checkSupabase();
  }, []);

  async function loadGraph() {
    if (!run) return;
    try {
      const data = await api(`/api/runs/${run.id}/graph`);
      setGraphEdges(data.graph?.edges || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load knowledge graph');
    }
  }

  async function refresh() {
    try {
      const data = await api('/api/runs');
      setRuns(data.runs);
      setSources(data.sources);
    } catch (e) {
      if (e instanceof Error) setError(e.message);
    }
  }

  useEffect(() => {
    refresh().catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('slack') === 'connect') setSlackError('Click Connect Slack to continue to Slack sign-in.');
    if (url.searchParams.get('slack') === 'error') setSlackError('Slack sign-in could not be completed. Try connecting again.');
    if (url.searchParams.has('slack')) {
      url.searchParams.delete('slack');
      window.history.replaceState(null, '', url);
    }
    api('/api/slack')
      .then(data => {
        setSlack(data);
        if (!data.workspaceId) return;
        const saved = (localStorage.getItem(`rev-slack-channels:${data.workspaceId}`) ?? '').split(',');
        setSlackIds(data.channels.filter((channel: { id: string }) => saved.includes(channel.id)).slice(0, 5).map((channel: { id: string }) => channel.id));
      })
      .catch(e => setSlackError(e.message))
      .finally(() => setSlackBusy(false));
  }, []);

  async function connectSlack() {
    if (window.location.hostname !== 'localhost') {
      window.location.assign('http://localhost:3077/?slack=connect');
      return;
    }
    setSlackBusy(true);
    setSlackError('');
    try {
      const data = await api('/api/slack', { method: 'POST' });
      window.location.assign(data.url);
    } catch (e) {
      setSlackError(e instanceof Error ? e.message : 'Could not start Slack sign-in.');
      setSlackBusy(false);
    }
  }

  function toggleSlackChannel(id: string) {
    const next = slackIds.includes(id) ? slackIds.filter(channel => channel !== id) : [...slackIds, id];
    setSlackIds(next);
    if (slack.workspaceId) localStorage.setItem(`rev-slack-channels:${slack.workspaceId}`, next.join(','));
  }

  function display(r: Run) {
    if (r.id !== run?.id) {
      setShareAnswers([]);
      setSyncTarget('local');
    }
    setSuccessorEmail(r.successorEmail ?? '');
    setTakeoverScope(r.takeoverScope ?? '');
    setRun(r);
    setSelected(r.selectedIds);
    setItems(r.items);
    setAuthorised(false);
    setRemote(false);
    setPartial(false);
    if (r.state === 'approved') {
      // Auto-fetch markdown text for the viewer
      fetch(`/api/runs/${r.id}/export`, { headers: { 'X-Rev-Request': '1' } })
        .then(res => (res.ok ? res.text() : null))
        .then(md => setExportedMarkdown(md))
        .catch(() => setExportedMarkdown(null));
    }
  }

  async function perform(fn: () => Promise<void>, onError?: (message: string) => void) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Operation failed';
      if (onError) onError(message);
      else setError(message);
      if (run) {
        try {
          const latest = await api(`/api/runs/${run.id}`);
          display(latest.run);
          await refresh();
        } catch {}
      }
    } finally {
      setBusy(false);
    }
  }

  async function create(fixture: boolean) {
    await perform(async () => {
      const email = successorEmailSchema.optional().safeParse(successorEmail.trim() || undefined);
      if (!email.success) throw new Error('Enter a valid successor email or leave it blank.');
      if (!fixture && file && file.size > 10 * 1024 * 1024) throw new Error('Slack ZIP exceeds 10 MiB');
      const zipBase64 = !fixture && file ? await fileAsBase64(file) : undefined;
      const result = await api('/api/runs', {
        method: 'POST',
        body: JSON.stringify({
          recipient: recipient.trim() || undefined,
          successorEmail: email.data,
          departingPerson: fixture ? 'maya' : departingPerson.trim() || undefined,
          targetRole: fixture ? 'Platform engineer' : targetRole.trim() || undefined,
          repo: fixture ? undefined : repo || undefined,
          zipBase64,
          fixture,
          localGit: !fixture && !!sources.localGit && useGit && !repo,
          localDocs: !fixture && !!sources.localGit && useGit && !repo,
          slackChannelIds: fixture || file ? [] : slackIds,
          connectedSlack: !fixture && sources.slack && useSlack && !file && !slackIds.length,
        }),
      });
      display(result.run);
    });
  }

  async function patch(body: object, onError?: (message: string) => void) {
    if (!run) return;
    let updated: Run | undefined;
    await perform(async () => {
      const data = await api(`/api/runs/${run.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      updated = data.run;
      display(data.run);
      if (graphEdges !== null) {
        const graph = await api(`/api/runs/${run.id}/graph`).catch(() => null);
        if (graph?.graph?.edges) setGraphEdges(graph.graph.edges);
      }
    }, onError);
    return updated;
  }

  async function updateSelection(next: string[]) {
    if (!run || busy) return;
    setSelected(next);
    setBusy(true);
    setError('');
    setAuthorised(false);
    try {
      const d = await api(`/api/runs/${run.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'scope', selectedIds: next }),
      });
      setRun(d.run);
      setSelected(d.run.selectedIds);
      setItems(d.run.items);
      await refresh();
    } catch (e) {
      setSelected(selected);
      setError(e instanceof Error ? e.message : 'Could not update source scope');
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    return updateSelection(selected.includes(id) ? selected.filter(sourceId => sourceId !== id) : [...selected, id]);
  }

  function updateItem(id: string, changes: Partial<Item>) {
    setItems(old => old.map(item => (item.id === id ? { ...item, ...changes } : item)));
  }

  async function download() {
    if (!run) return;
    await perform(async () => {
      const resp = await fetch(`/api/runs/${run.id}/export`, { headers: { 'X-Rev-Request': '1' } });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error);
      }
      const text = await resp.text();
      setExportedMarkdown(text);
      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rev-handover-${(run.departingPerson || 'project').toLowerCase()}.md`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  async function publishToDevPortal() {
    if (!run) return;
    const uploadToCloud = syncTarget === 'cloud';
    if (uploadToCloud) setSyncTarget('local');
    try {
      const published = JSON.parse(localStorage.getItem('rev_published_handovers') || '[]');
      const entry = {
        id: run.id,
        recipient: run.recipient,
        departingPerson: run.departingPerson || run.githubUsername || 'Unknown',
        targetRole: run.targetRole || 'Software Engineer',
        publishedAt: new Date().toISOString(),
        publishedBy: 'Jordan Rivera (Admin)',
        storageMode: syncTarget,
      };
      const updated = [entry, ...published.filter((p: { id: string }) => p.id !== run.id)];
      localStorage.setItem('rev_published_handovers', JSON.stringify(updated));

      if (uploadToCloud) {
        setSyncingCloud(true);
        try {
          const savedSettings = JSON.parse(localStorage.getItem('rev_system_settings') || '{}');
          const connectionString = savedSettings.postgresUri?.trim() || undefined;

          const res = await fetch('/api/sync/supabase', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Rev-Request': '1',
            },
            body: JSON.stringify({ runId: run.id, connectionString, confirmSync: true }),
          });
          const syncRes = await res.json();
          if (syncRes.success) {
            setPublishedNotice('Successfully published to Successor Portal & synced to Supabase!');
          } else {
            setPublishedNotice(
              `Published locally in PGlite. (${syncRes.fallback === 'local' ? 'Local mode active' : 'Remote sync pending'})`
            );
          }
        } catch {
          setPublishedNotice('Published locally in PGlite (cloud unreachable, safe local fallback).');
        } finally {
          setSyncingCloud(false);
        }
      } else {
        setPublishedNotice('Published to Successor Portal (Local Sovereignty preserved in PGlite).');
      }

      setTimeout(() => setPublishedNotice(''), 5000);
    } catch {
      // Ignore
    }
  }

  const commitIds = run?.artifacts.filter(source => source.kind === 'git_commit' || source.kind === 'git_document' || source.kind === 'github_commit').map(source => source.id) ?? [];
  const selectionWithCommits = [...new Set([...selected, ...commitIds])];
  const coverageWarnings = sourceWarnings(run?.warnings ?? []);
  const generationFailure = run?.warnings.filter(warning => warning.startsWith(generationFailurePrefix)).at(-1);
  const areas = run ? suggestedAreas(run) : [];
  const actions = run ? dayOneItems(run, items.filter(item => run.items.find(saved => saved.id === item.id)?.text === item.text)) : [];
  const pendingShareIds = shareAnswers.filter(id =>
    !run?.selectedIds.includes(id) && run?.gaps?.some(gap => gap.answerSourceId === id));
  const scopeChanged = Boolean((run?.departingPerson || run?.githubUsername) && takeoverScope.trim() !== (run.takeoverScope ?? ''));

  function getActiveStage(): number {
    if (!run || run.state === 'importing') return 1;
    if (run.state === 'awaiting_scope_confirmation' || run.state === 'reconstructing') return 2;
    if (run.state === 'needs_review') return 3;
    if (run.state === 'approved') return 4;
    return 1;
  }
  const activeStage = getActiveStage();
  const assignment = run && (
    <form className="notice" onSubmit={event => {
      event.preventDefault();
      void patch({ action: 'assign_successor', email: successorEmail.trim() || null });
    }}>
      <h3>Assign successor</h3>
      <label>Successor email<input type="email" value={successorEmail} maxLength={254}
        placeholder="alex.vance@team.internal" onChange={event => setSuccessorEmail(event.target.value)} /></label>
      <p className="footnote">Use the email they sign in with. Leave it blank to clear the assignment.</p>
      <button type="submit" className="secondary" disabled={busy || JSON.stringify(items) !== JSON.stringify(run.items) || successorEmail.trim().toLowerCase() === (run.successorEmail ?? '')}>
        Save successor assignment
      </button>
      {run.successorEmail && <p role="status">Assigned to {run.successorEmail}</p>}
    </form>
  );


  function resetToNewRun() {
    setRun(null);
    setSuccessorEmail('');
    setShowSuccessor(false);
    setSelected([]);
    setItems([]);
    setExportedMarkdown(null);
    setAuthorised(false);
  }

  return (
    <div className="m3-wizard-layout">
      {/* Studio Header & Stepper */}
      <section className="hero">
        <div>
          <div className="eyebrow">CREATION STUDIO · MATERIAL 3 EXPRESSIVE</div>
          <h1>
            Knowledge, <em>carried forward.</em>
          </h1>
          <p>
            Capture scattered Git commits and Slack discussions, filter authorised evidence, review factual claims, and assign to your onboarding successor.
          </p>
        </div>
        <div className="hero-number">
          0{activeStage} <span>/ 04</span>
          <small>
            {activeStage === 1
              ? 'IMPORT SOURCES'
              : activeStage === 2
              ? 'SELECT SOURCES'
              : activeStage === 3
              ? 'REVIEW CLAIMS'
              : 'EXPORT & ASSIGN'}
          </small>
        </div>
      </section>

      {/* Stage Stepper: Step indicator and navigation */}
      <ol className="stage-stepper" aria-label="Handover progress">
        <li
          className={`stage-step ${activeStage > 1 ? 'completed' : ''}`}
          aria-current={activeStage === 1 ? 'step' : undefined}
          onClick={() => { if (run) resetToNewRun(); }}
          style={{ cursor: run ? 'pointer' : 'default' }}
          title={run ? 'Click to start a fresh import' : undefined}
        >
          <span className="stage-step-num">{activeStage > 1 ? '✓' : '1'}</span>
          <span>Import</span>
        </li>
        <li
          className={`stage-step ${activeStage > 2 ? 'completed' : ''}`}
          aria-current={activeStage === 2 ? 'step' : undefined}
        >
          <span className="stage-step-num">{activeStage > 2 ? '✓' : '2'}</span>
          <span>Select sources</span>
        </li>
        <li
          className={`stage-step ${activeStage > 3 ? 'completed' : ''}`}
          aria-current={activeStage === 3 ? 'step' : undefined}
        >
          <span className="stage-step-num">{activeStage > 3 ? '✓' : '3'}</span>
          <span>Review</span>
        </li>
        <li
          className={`stage-step ${activeStage === 4 ? 'completed' : ''}`}
          aria-current={activeStage === 4 ? 'step' : undefined}
        >
          <span className="stage-step-num">4</span>
          <span>Export</span>
        </li>
      </ol>

      {error && <div role="alert" className="error">{error}</div>}
      {publishedNotice && <div role="status" className="notice">{publishedNotice}</div>}

      <div className="grid">
        {/* Main Step Studio Column */}
        <div className="column">
          {/* SCREEN 1: CONNECT & IMPORT */}
          {activeStage === 1 && (
            <section className="card entry-panel m3-wizard-screen m3-slide-in" aria-labelledby="screen-1-title">
              <div className="card-head">
                <div>
                  <div className="eyebrow">01 / CONNECT</div>
                  <h2 id="screen-1-title">Start a run</h2>
                  <p>Import activity from local Git history or connected Slack channels. Import only material you are authorised to use.</p>
                </div>
                <span className="step-icon">↗</span>
              </div>

              <ContributorField value={departingPerson} onChange={setDepartingPerson}
                authors={useGit && !repo ? sources.gitAuthors : []} repository={sources.localGit} />

              <div className="button-row">
                <button type="button" className="secondary" aria-expanded={showSuccessor}
                  aria-controls="initial-successor" onClick={() => setShowSuccessor(open => !open)}>
                  Assign successor
                </button>
              </div>
              <div id="initial-successor" hidden={!showSuccessor}>
                <label>Successor email <span className="muted">optional</span>
                  <input type="email" value={successorEmail} maxLength={254}
                    placeholder="alex.vance@team.internal" onChange={event => setSuccessorEmail(event.target.value)} />
                </label>
                <p className="footnote">Use their sign-in email. The assignment is saved when you start the run.</p>
              </div>

              <label>
                Target role <span className="muted">optional</span>
                <input
                  value={targetRole}
                  onChange={e => setTargetRole(e.target.value)}
                  maxLength={120}
                  placeholder="Senior backend engineer"
                />
              </label>

              <details>
                <summary>Optional settings</summary>
                <label>
                  Incoming role
                  <input
                    value={recipient}
                    onChange={e => setRecipient(e.target.value)}
                    maxLength={120}
                  />
                </label>
              </details>

              {sources.localGit && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={useGit && !repo}
                    disabled={!!repo || busy}
                    onChange={e => setUseGit(e.target.checked)}
                  />{' '}
                  Use matching local Git commits and committed project docs from {sources.localGit}
                </label>
              )}

              <div>
                {slack.workspace && <p>Slack workspace: <strong>{slack.workspace}</strong></p>}
                <button
                  type="button"
                  className="secondary"
                  disabled={slackBusy || busy}
                  onClick={() => void connectSlack()}
                >
                  {slack.workspace ? 'Reconnect Slack' : 'Connect Slack'}
                </button>
                {slackError && <p role="status">{slackError}</p>}
                {slack.workspace &&
                  (slack.channels.length ? (
                    <details open>
                      <summary>Choose Slack channels ({slackIds.length} selected)</summary>
                      <p className="footnote">
                        Select up to five project channels. ReV checks recent messages when you import.
                      </p>
                      {slack.channels.map(channel => (
                        <label className="check" key={channel.id}>
                          <input
                            type="checkbox"
                            disabled={busy || !!file || (slackIds.length >= 5 && !slackIds.includes(channel.id))}
                            checked={slackIds.includes(channel.id)}
                            onChange={() => toggleSlackChannel(channel.id)}
                          />{' '}
                          #{channel.name}
                        </label>
                      ))}
                    </details>
                  ) : (
                    <p>No channels found. Join a project channel in Slack and reload ReV.</p>
                  ))}
              </div>

              {sources.slack && !slack.workspace && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={useSlack && !file}
                    disabled={!!file || busy}
                    onChange={e => setUseSlack(e.target.checked)}
                  />{' '}
                  Import from connected Slack channels
                </label>
              )}

              <details>
                <summary>Import from another source</summary>
                <label>
                  GitHub repository <span className="muted">optional</span>
                  <input
                    value={repo}
                    onChange={e => setRepo(e.target.value)}
                    placeholder="owner/repository"
                  />
                </label>
                <label>
                  Slack export ZIP <span className="muted">optional · max 10 MiB</span>
                  <input
                    type="file"
                    accept=".zip,application/zip"
                    onChange={e => setFile(e.target.files?.[0] || null)}
                  />
                </label>
              </details>

              <div className="button-row">
                <button
                  disabled={busy || !departingPerson.trim()}
                  onClick={() => create(false)}
                >
                  Import sources <span>→</span>
                </button>
                <button
                  disabled={busy}
                  className="secondary"
                  onClick={() => create(true)}
                >
                  Try synthetic example
                </button>
              </div>
              <p className="footnote">
                Configure the GitHub token and model provider in the daemon environment or Settings tab.
              </p>
            </section>
          )}

          {/* SCREEN 2: SELECT SOURCES */}
          {activeStage === 2 && run && (
            <section className="card m3-wizard-screen m3-slide-in" aria-labelledby="screen-2-title">
              <div className="card-head">
                <div>
                  <div className="eyebrow">02 / SELECT SOURCES</div>
                  <h2 id="screen-2-title">Choose what can be shared</h2>
                  <p>
                    Imported sources start unselected. Nothing is sent to a model until you confirm the recipient’s access.
                  </p>
                </div>
                <span className="count">{selected.length}/{run.artifacts.length}</span>
              </div>

              {run.mode === 'fixture' && (
                <div className="notice">
                  Synthetic fixture · generation uses deterministic example output, not an AI model.
                </div>
              )}
              {generationFailure && <div className="warning" role="status">{generationFailure}</div>}
              {coverageWarnings.length > 0 && (
                <div className="warning">
                  <strong>Incomplete coverage</strong>
                  {coverageWarnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={partial}
                      onChange={e => setPartial(e.target.checked)}
                    />{' '}
                    I understand the source coverage is incomplete.
                  </label>
                </div>
              )}

              {(run.departingPerson || run.githubUsername) && (
                <div>
                  <label>
                    What are you taking over? <span className="muted">(optional)</span>
                    <input
                      value={takeoverScope}
                      onChange={e => setTakeoverScope(e.target.value)}
                      maxLength={400}
                      placeholder="e.g. Billing retries and alerts"
                    />
                  </label>
                  <p>
                    Select the evidence for {run.departingPerson || run.githubUsername}’s handover. Add responsibilities if you want to focus the draft.
                  </p>
                  {areas.length > 0 && (
                    <>
                      <p>Areas found in their Git activity</p>
                      <div className="button-row">
                        {areas.map(area => (
                          <button
                            type="button"
                            className="secondary"
                            key={area}
                            onClick={() =>
                              setTakeoverScope(value =>
                                value.includes(area) ? value : [value, area].filter(Boolean).join(', ').slice(0, 400)
                              )
                            }
                          >
                            {area}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {scopeChanged && ['needs_review', 'approved'].includes(run.state) && (
                    <p>Generate a new draft to apply the changed responsibilities.</p>
                  )}
                </div>
              )}

              {commitIds.length > 0 && (
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || selectionWithCommits.length === selected.length || selectionWithCommits.length > 500}
                    onClick={() => void updateSelection(selectionWithCommits)}
                  >
                    Select commits and repository docs
                  </button>
                  {selectionWithCommits.length > 500 && (
                    <small>Clear other sources to stay within the 500-source limit.</small>
                  )}
                </div>
              )}

              <div className="source-list">
                {run.artifacts.map(a => (
                  <label
                    className={`source ${selected.includes(a.id) ? 'selected' : ''}`}
                    key={a.id}
                  >
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={selected.includes(a.id)}
                      onChange={() => void toggle(a.id)}
                    />
                    <span>
                      <b>{a.kind.replaceAll('_', ' ')}</b>
                      <small>{a.sourceRef}{a.author ? ` · ${a.author}` : ''}</small>
                      {(run.githubUsername || run.departingPerson) &&
                        (a.githubLogin?.toLowerCase() === (run.githubUsername || run.departingPerson)?.toLowerCase() ||
                          a.author?.toLowerCase() === (run.githubUsername || run.departingPerson)?.toLowerCase()) && (
                          <small>GitHub-linked contributor match: @{a.githubLogin || a.author}</small>
                        )}
                      {a.paths?.length ? <small>{a.paths.slice(0, 4).join(', ')}</small> : null}
                      <span className="source-text">{a.text}</span>
                    </span>
                  </label>
                ))}
              </div>

              <div className="auth-guardrails">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={authorised}
                    onChange={e => setAuthorised(e.target.checked)}
                  />{' '}
                  I confirm the recipient may receive all selected material.
                </label>
                {run.mode !== 'fixture' && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={remote}
                      onChange={e => setRemote(e.target.checked)}
                    />{' '}
                    I consent to sending selected text{run.departingPerson ? ' and handover details' : ''} to my configured model provider.
                  </label>
                )}
              </div>

              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  onClick={resetToNewRun}
                  disabled={busy}
                >
                  ← Back to Connect
                </button>
                <button
                  className="primary-action"
                  disabled={
                    busy ||
                    !selected.length ||
                    !authorised ||
                    (!!coverageWarnings.length && !partial) ||
                    (run.mode !== 'fixture' && !remote)
                  }
                  onClick={() =>
                    patch({
                      action: 'generate',
                      takeoverScope: run.departingPerson ? takeoverScope.trim() : undefined,
                      selectedIds: selected,
                      acceptPartial: partial,
                      confirmAuthorisation: true,
                      confirmRemote: remote,
                      fixture: run.mode === 'fixture',
                    })
                  }
                >
                  Generate draft <span>→</span>
                </button>
              </div>
            </section>
          )}

          {/* SCREEN 3: REVIEW CLAIMS */}
          {activeStage === 3 && run && ['needs_review', 'approved'].includes(run.state) && (
            <section className="card m3-wizard-screen m3-slide-in" aria-labelledby="screen-3-title">
              <div className="card-head">
                <div>
                  <div className="eyebrow">03 / REVIEW</div>
                  <h2 id="screen-3-title">Make it yours</h2>
                  <p>Check the meaning, not just the citation. Editing a claim marks it unverified.</p>
                </div>
                <span className="count">{items.length} ITEMS</span>
              </div>

              {run.departingPerson && !scopeChanged && (
                <div className="notice">
                  <h3>Start here</h3>
                  {actions.length ? (
                    <>
                      <p>{actions[0].text}</p>
                      <ul>
                        {[...new Set(actions[0].citations.map(cite => cite.sourceId))].map(id => {
                          const source = run.artifacts.find(artifact => artifact.id === id);
                          if (!source) return null;
                          return (
                            <li key={id}>
                              {source.url?.startsWith('https://github.com/') ? (
                                <a href={source.url}>{source.sourceRef}</a>
                              ) : (
                                source.sourceRef
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <p>Confirm the first task with the team. The draft has no next action with evidence ready for review.</p>
                  )}
                  {actions.length > 1 && (
                    <>
                      <h4>Day 1 follow-ups</h4>
                      <ol>
                        {actions.slice(1).map(action => (
                          <li key={action.id}>{action.text}</li>
                        ))}
                      </ol>
                    </>
                  )}
                </div>
              )}

              {assignment}
              <DepartureInterview key={run.id} run={run} busy={busy} hasUnsavedEdits={JSON.stringify(items) !== JSON.stringify(run.items)} patch={patch} shareIds={shareAnswers} toggleShare={toggleShare} />
              {items.map(item => (
                <div className="review-item" key={item.id}>
                  <div className="review-meta">
                    <strong>{item.category.replaceAll('_', ' ')}</strong>
                    <span className={`status-pill ${item.verification === 'validated_reference' ? 'valid' : 'uncertain'}`}>
                      {item.verification.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <label>
                    Handover text
                    <textarea
                      value={item.text}
                      onChange={e => updateItem(item.id, { text: e.target.value })}
                    />
                  </label>
                  {item.citations.map((c, i) => {
                    const src = run.artifacts.find(s => s.id === c.sourceId);
                    return (
                      <div className="citation" key={i}>
                        <small>↳ {src?.sourceRef || 'Missing source'}</small>
                        <p>“{c.quote}”</p>
                      </div>
                    );
                  })}
                  <div className="review-options">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={item.excluded}
                        onChange={e => updateItem(item.id, { excluded: e.target.checked })}
                      />{' '}
                      Exclude
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={item.needsClarification}
                        onChange={e => updateItem(item.id, { needsClarification: e.target.checked })}
                      />{' '}
                      Needs clarification
                    </label>
                  </div>
                </div>
              ))}

              {/* Verification Tools: Gaps, Divergence & Evidence Graph */}
              <details style={{ marginTop: '16px', marginBottom: '16px', padding: '12px 14px', borderRadius: '12px', background: '#f8faf8', border: '1px solid #d9e6dc' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '13px', color: '#174a3d' }}>
                  Verification Tools · Gaps ({run.gaps?.filter(g => g.status === 'open').length ?? 0}), Divergence &amp; Evidence Graph
                </summary>
                <div className="button-row" style={{ marginTop: '12px', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => patch({ action: 'detect_gaps' })}
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    Detect Evidence Gaps
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || run.selectedIds.length < 2 || !remote}
                    title={!remote ? 'Confirm remote model consent in Step 2 to compare divergence' : undefined}
                    onClick={() => patch({ action: 'detect_divergence', selectedIds: run.selectedIds, confirmRemote: true })}
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    Check Source Divergence
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void loadGraph()}
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    Inspect Knowledge Graph
                  </button>
                </div>

                {!!run.gaps?.length && (
                  <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {run.gaps.map(gap => (
                      <div key={gap.id} style={{ padding: '10px', borderRadius: '8px', background: '#fff', border: '1px solid #e2e8f0', fontSize: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <strong>{gap.question}</strong>
                          <span className={`status-pill ${gap.status === 'answered' ? 'valid' : 'uncertain'}`}>{gap.status}</span>
                        </div>
                        {gap.status === 'open' && (
                          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                            <input
                              type="text"
                              placeholder="Provide clarification answer..."
                              value={gapAnswers[gap.id] || ''}
                              onChange={e => setGapAnswers(prev => ({ ...prev, [gap.id]: e.target.value }))}
                              style={{ flex: 1, fontSize: '12px', padding: '6px 8px' }}
                            />
                            <button
                              type="button"
                              className="secondary"
                              disabled={busy || !gapAnswers[gap.id]?.trim()}
                              onClick={() =>
                                patch({
                                  action: 'answer_gap',
                                  gapId: gap.id,
                                  answer: gapAnswers[gap.id].trim(),
                                  selectedIds: run.selectedIds,
                                })
                              }
                              style={{ fontSize: '12px', padding: '6px 10px' }}
                            >
                              Submit Answer
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {graphEdges && (
                  <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <small style={{ color: '#475569', fontWeight: 600 }}>
                      Evidence Graph Edges ({graphEdges.length})
                    </small>
                    {graphEdges.length === 0 ? (
                      <small className="footnote">No graph relationships recorded for this revision yet.</small>
                    ) : (
                      graphEdges.slice(0, 10).map(edge => (
                        <div key={edge.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}>
                          <span>
                            <strong>{edge.type}</strong> · <span className={`status-pill ${edge.status === 'confirmed' ? 'valid' : 'uncertain'}`}>{edge.status}</span>
                          </span>
                          {edge.status === 'proposed' && (
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button
                                type="button"
                                className="secondary"
                                disabled={busy}
                                onClick={() => patch({ action: 'graph_review', edgeId: edge.id, decision: 'confirmed' })}
                                style={{ fontSize: '11px', padding: '4px 8px' }}
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                disabled={busy}
                                onClick={() => patch({ action: 'graph_review', edgeId: edge.id, decision: 'rejected' })}
                                style={{ fontSize: '11px', padding: '4px 8px' }}
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </details>

              <div className="auth-guardrails">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={authorised}
                    onChange={e => setAuthorised(e.target.checked)}
                  />{' '}
                  I confirm the selected sources are authorised for this recipient.
                </label>
              </div>

              {(() => {
                const hasPendingEdits = JSON.stringify(items) !== JSON.stringify(run.items);
                const canApprove =
                  !hasPendingEdits &&
                  run.state === 'needs_review' &&
                  authorised &&
                  !scopeChanged &&
                  JSON.stringify([...selected].sort()) === JSON.stringify([...run.selectedIds].sort());

                return (
                  <div className="button-row">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => patch({ action: 'scope', selectedIds: selected })}
                      disabled={busy}
                    >
                      ← Back to Sources
                    </button>
                    <button
                      className={hasPendingEdits ? 'primary-action' : 'secondary'}
                      disabled={busy}
                      onClick={() => patch({ action: 'save', items })}
                    >
                      Save review
                    </button>
                    <button
                      className={canApprove ? 'primary-action' : 'secondary'}
                      disabled={busy || !canApprove}
                      onClick={() => patch({ action: 'approve', confirmAuthorisation: true, interviewAnswerIds: pendingShareIds })}
                    >
                      Approve current revision
                    </button>
                  </div>
                );
              })()}
              <p className="footnote">
                Save edits before approving. Changing source selection requires generating a new draft.
              </p>
            </section>
          )}

          {/* SCREEN 4: EXPORT & SUCCESSOR ASSIGNMENT */}
          {activeStage === 4 && run && (
            <section className="card m3-wizard-screen m3-slide-in" aria-labelledby="screen-4-title">
              <div className="card-head">
                <div>
                  <div className="eyebrow">04 / EXPORT & ASSIGN</div>
                  <h2 id="screen-4-title">Handover approved & ready</h2>
                  <p>Knowledge verified against source evidence. Ready to share with the successor developer.</p>
                </div>
                <span className="status-pill valid">APPROVED</span>
              </div>

              {assignment}
              <DepartureInterview key={run.id} run={run} busy={busy} patch={patch} shareIds={shareAnswers} toggleShare={toggleShare} />

              {pendingShareIds.length > 0 && <button type="button" className="primary-action" disabled={busy}
                onClick={() => patch({ action: 'approve', confirmAuthorisation: true, interviewAnswerIds: pendingShareIds })}>
                Approve and share selected interview answers
              </button>}

              <div className="m3-assignment-card">
                <div className="m3-assignment-grid">
                  <div>
                    <span className="m3-label-sm">DEPARTING CONTRIBUTOR</span>
                    <strong>{run.departingPerson || run.githubUsername || 'Unknown'}</strong>
                    {run.githubUsername && <p className="footnote">Contributor: @{run.githubUsername}</p>}
                  </div>
                  <div>
                    <span className="m3-label-sm">TARGET ROLE</span>
                    <strong>{run.targetRole || 'Engineering Lead / Developer'}</strong>
                    <p className="footnote">Target role: {run.targetRole || 'Not specified'}</p>
                  </div>
                  <div>
                    <span className="m3-label-sm">ASSIGNED SUCCESSOR</span>
                    <strong>{run.successorEmail ?? 'Unassigned'}</strong>
                    <p className="footnote">Recipient: {run.recipient}</p>
                  </div>
                </div>

                {/* Storage Sovereignty vs Cloud Sync Radio at Final Submission */}
                <div style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
                  <div className="eyebrow" style={{ marginBottom: '8px' }}>STORAGE & SOVEREIGNTY TARGET</div>
                  <div className="m3-storage-picker" style={{ gap: '8px' }}>
                    <label className={`m3-storage-option ${syncTarget === 'cloud' ? 'active' : ''}`} style={{ cursor: 'pointer', padding: '12px 14px' }}>
                      <input
                        type="radio"
                        name="submissionSyncTarget"
                        value="cloud"
                        checked={syncTarget === 'cloud'}
                        onChange={() => setSyncTarget('cloud')}
                      />
                      <div>
                        <strong>Sync to Cloud &amp; Supabase {hasSupabaseConfigured ? '(Opt-in)' : ''}</strong>
                        <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#475569' }}>
                          {hasSupabaseConfigured
                            ? 'Upload this complete run, including its source material, to the configured database when you publish.'
                            : 'Supabase connection not configured in Settings — will default safely to local PGlite with zero errors.'}
                        </p>
                      </div>
                    </label>

                    <label className={`m3-storage-option ${syncTarget === 'local' ? 'active' : ''}`} style={{ cursor: 'pointer', padding: '12px 14px' }}>
                      <input
                        type="radio"
                        name="submissionSyncTarget"
                        value="local"
                        checked={syncTarget === 'local'}
                        onChange={() => setSyncTarget('local')}
                      />
                      <div>
                        <strong>Keep Local Only (PGlite Sovereignty) {!hasSupabaseConfigured ? '(Active Mode)' : ' (Default)'}</strong>
                        <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#475569' }}>
                          Do not upload this handover during publishing. A later manual sync can still send it.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="button-row" style={{ marginTop: '18px' }}>
                  <button
                    type="button"
                    className="primary-action"
                    onClick={publishToDevPortal}
                    disabled={syncingCloud}
                  >
                    {syncingCloud ? 'Syncing & Publishing...' : '🚀 Publish to Successor Portal'}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={download}
                    disabled={busy}
                  >
                    Download Markdown
                  </button>
                  {onBackToProjects && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={onBackToProjects}
                    >
                      ← Return to Projects
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    onClick={resetToNewRun}
                  >
                    + New Handover
                  </button>
                </div>
              </div>

              {/* Rendered Handover Markdown Viewer */}
              {exportedMarkdown && (
                <div className="m3-markdown-viewer-card">
                  <div className="m3-markdown-header">
                    <strong>Generated Handover Document Preview</strong>
                    <small>rev-handover.md</small>
                  </div>
                  <pre className="m3-markdown-pre">{exportedMarkdown}</pre>
                </div>
              )}

              {/* Collapsible Audited Evidence Sources (Maintains compatibility with tests asserting label.source) */}
              <details style={{ marginTop: '20px' }}>
                <summary>Audited Evidence Sources ({selected.length} items included)</summary>
                <p className="footnote">
                  Modifying included sources below will revoke the current approval and return to source scoping.
                </p>
                <div className="source-list">
                  {run.artifacts
                    .filter(a => selected.includes(a.id))
                    .map(a => (
                      <label className="source selected" key={a.id}>
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={selected.includes(a.id)}
                          onChange={() => void toggle(a.id)}
                        />
                        <span>
                          <b>{a.kind.replaceAll('_', ' ')}</b>
                          <small>{a.sourceRef}{a.author ? ` · ${a.author}` : ''}</small>
                          <span className="source-text">{a.text}</span>
                        </span>
                      </label>
                    ))}
                </div>
              </details>
            </section>
          )}
        </div>

        {/* Right Sidebar Column: Daemon & Workspace Runs */}
        <div className="column">
          <ProjectDashboard />

          <section className="card compact">
            <div className="eyebrow">YOUR WORKSPACE</div>
            <h2>Recent runs</h2>
            <p>Each run is a separate snapshot.</p>
            {runs.length === 0 ? (
              <div className="empty">
                No handovers yet.<br />
                <span>Start a run or try the example.</span>
              </div>
            ) : (
              <div className="runs">
                {runs.map(r => (
                  <button
                    className="run-row"
                    key={r.id}
                    onClick={() =>
                      perform(async () => {
                        const d = await api(`/api/runs/${r.id}`);
                        display(d.run);
                        if (onSelectRunForDetail) onSelectRunForDetail(d.run);
                      })
                    }
                  >
                    <span>
                      <b>{r.recipient}</b>
                      <small>{new Date(r.createdAt).toLocaleString()}</small>
                    </span>
                    <span className="run-state">{r.state.replaceAll('_', ' ')}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {run && (
            <section className="card compact">
              <div className="eyebrow">CURRENT RUN</div>
              <h3>{run.recipient}</h3>
              {run.githubUsername && <p>Contributor: @{run.githubUsername}</p>}
              {run.targetRole && <p>Target role: {run.targetRole}</p>}
              <p>Status: <b>{run.state.replaceAll('_', ' ')}</b></p>
              <div className="button-row">
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      if (!confirm('Delete this run and its stored snapshots? Downloaded exports cannot be revoked.')) return;
                      await api(`/api/runs/${run.id}`, { method: 'DELETE' });
                      setRun(null);
                    })
                  }
                >
                  Delete run
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

