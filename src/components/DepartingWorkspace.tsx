import { useEffect, useState } from 'react';
import type { Run } from '@/lib/contracts';
import DepartureInterview from '@/components/DepartureInterview';

type Summary = Pick<Run, 'id' | 'recipient' | 'state' | 'departingPerson' | 'githubUsername'>;
const profileKey = 'rev_departing_contributor';
const contributor = (run: Summary) => run.departingPerson || run.githubUsername || '';

async function request(url: string, body?: object) {
  const response = await fetch(url, {
    method: body ? 'PATCH' : 'GET',
    headers: { 'X-Rev-Request': '1', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load the interview');
  return data;
}

export default function DepartingWorkspace({ lead = false }: { lead?: boolean }) {
  const [runs, setRuns] = useState<Summary[]>([]);
  const [run, setRun] = useState<Run>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState('');
  const [shareIds, setShareIds] = useState<string[]>([]);

  async function refresh() {
    setBusy(true);
    setError('');
    try {
      const { runs }: { runs: Summary[] } = await request('/api/runs');
      setRuns(runs.filter(entry => entry.state === 'needs_review' || entry.state === 'approved'));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load handovers');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!lead) setProfile(localStorage.getItem(profileKey) ?? '');
    void refresh();
  }, [lead]);

  const profiles = [...new Set(runs.map(contributor).filter(Boolean))].sort();
  const visibleRuns = lead ? runs : runs.filter(entry => profile && contributor(entry).toLowerCase() === profile.toLowerCase());

  async function open(id: string) {
    setBusy(true);
    setError('');
    try {
      const data = await request(`/api/runs/${id}`);
      if (!lead && contributor(data.run).toLowerCase() !== profile.toLowerCase()) throw new Error('This handover belongs to another departing profile.');
      setShareIds([]);
      setRun(data.run);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not open the interview');
    } finally {
      setBusy(false);
    }
  }

  async function patch(body: object, onError?: (message: string) => void) {
    if (!run) return;
    setBusy(true);
    try {
      const data = await request(`/api/runs/${run.id}`, body);
      setRun(data.run);
      return data.run as Run;
    } catch (error) {
      (onError ?? setError)(error instanceof Error ? error.message : 'Could not save the answer');
    } finally {
      setBusy(false);
    }
  }

  return <section className="card m3e-card m3e-card--outlined question-inbox">
    <div className="question-inbox-header">
      <div>
        <h1>{lead ? 'Review handover replies' : 'Departing teammate profile'}</h1>
        <p>{lead ? 'Review and share replies with the successor.' : 'Choose your contributor profile to see questions for your handovers.'}</p>
      </div>
      {run && <div className="question-inbox-actions">
        <button type="button" className="secondary m3e-button m3e-button--tonal" disabled={busy} onClick={() => { setRun(undefined); void refresh(); }}>← Back to questions</button>
        <button type="button" className="secondary m3e-button m3e-button--tonal" disabled={busy} onClick={() => void open(run.id)}>Refresh</button>
      </div>}
    </div>
    {error && <p role="alert">{error}</p>}
    {run ? <>
      <h2>{run.departingPerson ? `${run.departingPerson} → ${run.recipient}` : run.recipient}</h2>
      <DepartureInterview key={run.id} run={run} role={lead ? 'lead' : 'departing'} reviewReplies={lead} busy={busy} patch={patch}
        shareIds={shareIds} toggleShare={id => setShareIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])} />
      {lead && shareIds.length > 0 && run.state !== 'approved' && <p>Approve the current draft in Projects before sharing replies.</p>}
      {lead && shareIds.length > 0 && <button type="button" className="primary-action m3e-button" disabled={busy || run.state !== 'approved'}
        onClick={async () => {
          const updated = await patch({ action: 'approve', confirmAuthorisation: true, interviewAnswerIds: shareIds });
          if (updated) setShareIds([]);
        }}>Approve and share selected replies</button>}
    </> : <div className="runs">
      {!lead && <label>Contributor profile<select className="m3-select" value={profiles.includes(profile) ? profile : ''} onChange={event => {
        setProfile(event.target.value);
        localStorage.setItem(profileKey, event.target.value);
      }}>
        <option value="">Choose your name</option>
        {profiles.map(name => <option key={name}>{name}</option>)}
      </select></label>}
      {busy && <p role="status">Loading interviews…</p>}
      {!busy && (lead || profile) && !visibleRuns.length && <p>No handovers are ready for this profile.</p>}
      {visibleRuns.map(entry => <button key={entry.id} className="run-row" disabled={busy} onClick={() => open(entry.id)}>
        <strong>{entry.recipient}</strong><span>Open questions</span>
      </button>)}
    </div>}
  </section>;
}
