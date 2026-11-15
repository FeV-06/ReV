'use client';

import type { Run } from '@/lib/contracts';

export type RunSummary = Pick<Run, 'id' | 'createdAt' | 'recipient' | 'state'>;

export default function RecentRuns({ runs, onSelect }: {
  runs: RunSummary[];
  onSelect: (id: string) => void;
}) {
  if (!runs.length) {
    return <div className="empty">No handovers yet.<br /><span>Start a run or try the example.</span></div>;
  }

  return (
    <div className="runs recent-runs-list" role="region" aria-label="Recent runs list" tabIndex={0}>
      {runs.map(run => (
        <button className="run-row" type="button" key={run.id} onClick={() => onSelect(run.id)}>
          <span><b>{run.recipient}</b><small>{new Date(run.createdAt).toLocaleString()}</small></span>
          <span className="run-state">{run.state.replaceAll('_', ' ')}</span>
        </button>
      ))}
    </div>
  );
}
