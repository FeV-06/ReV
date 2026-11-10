'use client';

import React, { useEffect, useState } from 'react';
import type { Run } from '@/lib/contracts';
import { useAuth } from '@/lib/auth-context';
import HandoverReader from '@/components/dev/HandoverReader';

type RunSummary = Pick<Run, 'id' | 'createdAt' | 'recipient' | 'state' | 'successorEmail'> & {
  departingPerson?: string;
  githubUsername?: string;
  targetRole?: string;
};

export default function DevDashboard() {
  const { user } = useAuth();
  const email = user?.email.trim().toLowerCase();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [markdownText, setMarkdownText] = useState<string>('');

  async function loadAssignedHandovers() {
    try {
      setLoading(true);
      const res = await fetch('/api/runs', {
        headers: { 'Content-Type': 'application/json', 'X-Rev-Request': '1' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load handovers');
      const available: RunSummary[] = data.runs ?? [];
      setRuns(available.filter(run => run.state === 'approved' && (!run.successorEmail || run.successorEmail === email)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error fetching handovers');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAssignedHandovers();
  }, [email]);

  async function openHandover(id: string) {
    try {
      setLoading(true);
      const res = await fetch(`/api/runs/${id}`, {
        headers: { 'Content-Type': 'application/json', 'X-Rev-Request': '1' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load run details');

      const run: Run = data.run;
      if (run.successorEmail && run.successorEmail !== email) throw new Error('This handover is assigned to another successor');
      if (run.state !== 'approved' || run.revision !== run.approvedRevision) {
        throw new Error('This handover is back in review. Reopen it after the lead approves it.');
      }
      const exp = await fetch(`/api/runs/${id}/export`, {
        headers: { 'X-Rev-Request': '1' },
      });
      if (!exp.ok) throw new Error('Could not load the current approved handover');
      const selected = new Set(run.selectedIds);
      setMarkdownText(await exp.text());
      setSelectedRun({ ...run, artifacts: run.artifacts.filter(source => selected.has(source.id)) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open handover');
    } finally {
      setLoading(false);
    }
  }

  if (selectedRun) {
    return (
      <HandoverReader
        run={selectedRun}
        markdownText={markdownText}
        onBack={() => setSelectedRun(null)}
      />
    );
  }

  return (
    <div className="m3-dev-dashboard">
      {/* Welcome Hero */}
      <section className="hero">
        <div>
          <div className="eyebrow">SUCCESSOR PORTAL · DAY 1 ONBOARDING</div>
          <h1>
            Welcome, <em>Alex.</em>
          </h1>
          <p>
            Here are the verified knowledge packages and handover documents prepared for your transition into your new role.
          </p>
        </div>
        <div className="m3-dev-badge-card">
          <span className="m3-dev-avatar">👤</span>
          <div>
            <strong>{user?.name}</strong>
            <small>Successor / Onboarding Engineer</small>
          </div>
        </div>
      </section>

      {error && <div role="alert" className="error">{error}</div>}

      {/* Assigned Handovers Grid */}
      <section className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">ASSIGNED HANDOVERS</div>
            <h2>Your Onboarding Documentation</h2>
            <p>
              Select a project handover to review Day 1 action items, operational architecture, and inspect evidence.
            </p>
          </div>
          <span className="count">{runs.length} ASSIGNED</span>
        </div>

        {loading ? (
          <p>Loading assigned handovers...</p>
        ) : runs.length === 0 ? (
          <div className="empty">
            No handovers assigned to your profile yet.
            <br />
            <span>
              Switch to <b>Admin / Lead</b> persona in the top navigation bar to create and approve a new handover.
            </span>
          </div>
        ) : (
          <div className="m3-dev-cards-grid">
            {runs.map(r => (
              <div
                key={r.id}
                className="m3-dev-card"
                onClick={() => openHandover(r.id)}
                role="button"
                tabIndex={0}
              >
                <div className="m3-dev-card-head">
                  <span className={`status-pill ${r.state === 'approved' ? 'valid' : 'uncertain'}`}>
                    {r.state === 'approved' ? 'READY FOR DAY 1' : r.state.replaceAll('_', ' ')}
                  </span>
                  <small>{new Date(r.createdAt).toLocaleDateString()}</small>
                </div>

                <h3 className="m3-dev-card-title">{r.recipient}</h3>

                <div className="m3-dev-card-info">
                  <div className="m3-dev-info-row">
                    <span className="m3-micro-label">Handed over by:</span>
                    <strong>{r.departingPerson || r.githubUsername || 'Maya Patel'}</strong>
                  </div>
                  <div className="m3-dev-info-row">
                    <span className="m3-micro-label">Assigned by:</span>
                    <span>Jordan Rivera (Tech Lead)</span>
                  </div>
                  {r.targetRole && (
                    <div className="m3-dev-info-row">
                      <span className="m3-micro-label">Role:</span>
                      <span>{r.targetRole}</span>
                    </div>
                  )}
                </div>

                <div className="m3-dev-card-action">
                  <span>Open Handover & Checklist →</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

