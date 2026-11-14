import { useEffect, useState } from 'react';
import type { Run } from '@/lib/contracts';
import DepartureInterview from '@/components/DepartureInterview';

type Summary = Pick<Run, 'id' | 'recipient' | 'state'>;

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

export default function DepartingWorkspace() {
  const [runs, setRuns] = useState<Summary[]>([]);
  const [run, setRun] = useState<Run>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    request('/api/runs').then(({ runs }: { runs: Summary[] }) =>
      setRuns(runs.filter(run => run.state === 'needs_review' || run.state === 'approved')))
      .catch(error => setError(error.message)).finally(() => setBusy(false));
  }, []);

  async function open(id: string) {
    setBusy(true);
    setError('');
    try {
      const data = await request(`/api/runs/${id}`);
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
      onError?.(error instanceof Error ? error.message : 'Could not save the answer');
    } finally {
      setBusy(false);
    }
  }

  return <section className="card m3e-card m3e-card--outlined">
    <h1>Your departure interviews</h1>
    <p>Choose a handover to see the questions prepared for the departing teammate.</p>
    {error && <p role="alert">{error}</p>}
    {run ? <>
      <button type="button" className="secondary m3e-button m3e-button--tonal" disabled={busy} onClick={() => setRun(undefined)}>Back to interviews</button>
      <h2>{run.departingPerson ? `${run.departingPerson} → ${run.recipient}` : run.recipient}</h2>
      <DepartureInterview key={run.id} run={run} role="departing" busy={busy} patch={patch} />
    </> : <div className="runs">
      {busy && <p role="status">Loading interviews…</p>}
      {!busy && !runs.length && <p>No handovers are ready for an interview.</p>}
      {runs.map(run => <button key={run.id} className="run-row" disabled={busy} onClick={() => open(run.id)}>
        <strong>{run.recipient}</strong><span>Open interview</span>
      </button>)}
    </div>}
  </section>;
}
