import { useState, type FormEvent } from 'react';
import type { Run } from '@/lib/contracts';

interface Reply {
  question: string;
  answer: string | null;
  followUp: string | null;
  citations: { sourceId: string; label: string; quote: string; url: string | null; author: string | null; timestamp: string | null }[];
}

export default function HandoverAssistant({ run }: { run: Run }) {
  const [question, setQuestion] = useState('');
  const [replies, setReplies] = useState<Reply[]>([]);
  const [remote, setRemote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = question.trim();
    if (!submitted || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/runs/${run.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Rev-Request': '1' },
        body: JSON.stringify({ question: submitted, confirmRemote: remote }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not answer the question');
      setReplies(previous => [...previous, { ...data, question: submitted }]);
      setQuestion('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not answer the question');
    } finally {
      setBusy(false);
    }
  }

  return <section className="card handover-assistant" aria-labelledby="handover-assistant">
    <h2 id="handover-assistant">Ask your handover assistant</h2>
    <p>Ask about decisions, next steps, or how something works. The assistant uses the approved project snapshot and shared interview answers.</p>
    {run.mode === 'fixture' && <p className="footnote">Synthetic demo. Replies are drawn from fixture records without AI inference.</p>}
    <div role="log" aria-label="Handover conversation">
      {replies.map((reply, index) => <div className="review-item" key={index}>
        <strong>You · {reply.question}</strong>
        <p>{reply.answer ?? 'I couldn’t find a supported answer in this handover.'}</p>
        {reply.citations.map((cite, i) => <div className="citation" key={`${cite.sourceId}-${i}`}>
          <small>{cite.url ? <a href={cite.url} target="_blank" rel="noreferrer">{cite.label}</a> : cite.label}
            {cite.author ? ` · ${cite.author}` : ''}{cite.timestamp ? ` · ${new Date(cite.timestamp).toLocaleDateString()}` : ''}
          </small>
          <p>“{cite.quote}”</p>
        </div>)}
        {reply.followUp && <p>Added to the departure interview: {reply.followUp}</p>}
      </div>)}
    </div>
    <form onSubmit={ask}>
      <label>Ask a question<input placeholder="Ask about a decision, a file, or what to do next…" value={question} maxLength={1000} disabled={busy}
        onChange={event => setQuestion(event.target.value)} /></label>
      {run.mode !== 'fixture' && <label className="check">
        <input type="checkbox" checked={remote} onChange={event => setRemote(event.target.checked)} />
        Allow this question and approved sources to be sent to the configured AI provider
      </label>}
      <button className="primary-action" disabled={busy || !question.trim() || (run.mode !== 'fixture' && !remote)}>
        {busy ? 'Looking for evidence…' : 'Ask assistant'}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>;
}
