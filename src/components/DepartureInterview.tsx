import { useState } from 'react';
import type { Run } from '@/lib/contracts';

interface Props {
  run: Run;
  busy: boolean;
  hasUnsavedEdits?: boolean;
  savesEditsOnPrepare?: boolean;
  patch: (body: object, onError?: (message: string) => void) => Promise<Run | undefined>;
  role?: 'lead' | 'departing';
  shareIds?: string[];
  toggleShare?: (id: string) => void;
}

export default function DepartureInterview({ run, busy, hasUnsavedEdits, savesEditsOnPrepare, patch, role = 'lead', shareIds = [], toggleShare }: Props) {
  const isLead = role === 'lead';
  const [remote, setRemote] = useState(false);
  const [author, setAuthor] = useState(run.departingPerson ?? run.githubUsername ?? '');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const gaps = run.gaps ?? [];
  const openCount = gaps.filter(gap => gap.status === 'open').length;
  const [preparing, setPreparing] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const requiresConsent = run.mode !== 'fixture' && !remote;

  async function prepare() {
    setPreparing(true);
    setStatus('');
    setError('');
    try {
      const updated = await patch({ action: 'prepare_interview', confirmRemote: remote }, setError);
      if (!updated) return;
      const existing = new Set(gaps.map(gap => gap.id));
      const added = (updated.gaps ?? []).filter(gap => !existing.has(gap.id)).length;
      setStatus(added
        ? `${added} new interview ${added === 1 ? 'question' : 'questions'} ready.`
        : 'No new questions found. Mark a claim “Needs clarification” and save the review to flag it for the interview.');
    } finally {
      setPreparing(false);
    }
  }

  return (
    <div className="notice departure-interview">
      <h3>Departure interview</h3>
      <p>{isLead ? 'Prepare questions for the departing person. Review their saved replies here before sharing them.'
        : 'Answer the questions below in any order. Your lead will review each reply before sharing it.'}</p>
      {isLead && <>
      {run.mode !== 'fixture' && <label className="check">
        <input type="checkbox" checked={remote} onChange={event => setRemote(event.target.checked)} />
        Allow selected sources and handover context to be sent to the configured AI provider
      </label>}
      {requiresConsent && <p className="footnote">Check the box above to enable question preparation.</p>}
      {hasUnsavedEdits && <p className="footnote">{savesEditsOnPrepare
        ? 'Preparing questions also saves your review edits.'
        : 'Save your review edits before preparing or answering questions.'}</p>}
      <button type="button" className="secondary m3e-button m3e-button--tonal" disabled={busy || preparing || (hasUnsavedEdits && !savesEditsOnPrepare) || requiresConsent}
        data-tour-control onClick={prepare}>
        {preparing ? 'Preparing interview questions…' : 'Prepare interview questions'}
      </button>
      <p role="status">{status}</p>
      </>}
      {error && <p role="alert">{error}</p>}
      {gaps.length > 0 ? <>
        <div className="interview-list-header">
          <strong>{gaps.length - openCount} of {gaps.length} answered</strong>
          {!isLead && openCount > 0 && <label>Your name
            <input value={author} maxLength={120} onChange={event => setAuthor(event.target.value)} />
          </label>}
        </div>
        <ol className="interview-questions" aria-label="Interview questions">
          {gaps.map((gap, index) => {
            if (isLead && gap.status === 'open') return null;
            const answer = run.artifacts.find(source => source.id === gap.answerSourceId);
            const shared = answer && run.selectedIds.includes(answer.id);
            return <li key={gap.id} className="interview-question">
              <div className="interview-question-meta">
                <span>{gap.origin === 'successor' ? 'From the successor' : 'From the handover'}</span>
                <span className={answer ? 'status-pill valid' : 'status-pill'}>{shared ? 'Shared' : answer ? 'Answered' : 'Open'}</span>
              </div>
              <h4>{gap.question}</h4>
              {gap.sourceIds.length > 0 && <details className="interview-evidence">
                <summary>Source evidence ({gap.sourceIds.length})</summary>
                <ul>{gap.sourceIds.map(id => {
                  const source = run.artifacts.find(artifact => artifact.id === id);
                  return source && <li key={id}>
                    {source.url?.startsWith('https://')
                      ? <a href={source.url} target="_blank" rel="noreferrer">{source.sourceRef}</a>
                      : <strong>{source.sourceRef}</strong>}
                    <p>{source.text}</p>
                  </li>;
                })}</ul>
              </details>}
              {answer ? <>
                <p className="interview-saved-answer">{answer.text}</p>
                <small>Recorded from {answer.author}{answer.timestamp ? ` · ${new Date(answer.timestamp).toLocaleDateString()}` : ''}</small>
                {isLead && !shared && <label className="check">
                  <input type="checkbox" checked={shareIds.includes(answer.id)} disabled={busy}
                    onChange={() => toggleShare?.(answer.id)} />
                  Share this answer when approving the handover
                </label>}
              </> : <>
                <label>Your answer to question {index + 1}
                  <textarea value={answers[gap.id] ?? ''} maxLength={4000}
                    onChange={event => setAnswers(old => ({ ...old, [gap.id]: event.target.value }))} />
                </label>
                <button type="button" className="secondary m3e-button m3e-button--tonal"
                  disabled={busy || hasUnsavedEdits || !author.trim() || !answers[gap.id]?.trim()}
                  onClick={() => {
                    setError('');
                    void patch({ action: 'answer_gap', gapId: gap.id, author, answer: answers[gap.id], selectedIds: run.selectedIds }, setError);
                  }}>
                  Save interview answer
                </button>
              </>}
            </li>;
          })}
        </ol>
      </> : <p>No interview questions yet.</p>}
    </div>
  );
}
