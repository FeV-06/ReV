'use client';

import React, { useEffect, useState } from 'react';
import type { Run } from '@/lib/contracts';
import ProjectDashboard from '@/components/ProjectDashboard';

type RunSummary = Pick<Run, 'id' | 'createdAt' | 'recipient' | 'state' | 'successorEmail'> & {
  departingPerson?: string;
  githubUsername?: string;
  targetRole?: string;
};

interface ProjectListProps {
  onOpenRunInWizard: (runId: string) => void;
}

export default function ProjectList({ onOpenRunInWizard }: ProjectListProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [markdownContent, setMarkdownContent] = useState<string | null>(null);
  const [markdownLoading, setMarkdownLoading] = useState(false);

  async function loadRuns() {
    try {
      setLoading(true);
      const res = await fetch('/api/runs', {
        headers: { 'Content-Type': 'application/json', 'X-Rev-Request': '1' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load runs');
      setRuns(data.runs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error loading projects');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRuns();
  }, []);

  async function viewProjectDetail(runSummary: RunSummary) {
    try {
      setMarkdownLoading(true);
      const res = await fetch(`/api/runs/${runSummary.id}`, {
        headers: { 'Content-Type': 'application/json', 'X-Rev-Request': '1' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch run details');
      setSelectedRun(data.run);

      if (data.run.state === 'approved') {
        const exp = await fetch(`/api/runs/${runSummary.id}/export`, {
          headers: { 'X-Rev-Request': '1' },
        });
        if (exp.ok) {
          const text = await exp.text();
          setMarkdownContent(text);
        } else {
          setMarkdownContent(null);
        }
      } else {
        setMarkdownContent(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load details');
    } finally {
      setMarkdownLoading(false);
    }
  }

  return (
    <div className="m3-projects-view">
      {/* If a Project is selected, show the Project Detail & Markdown Viewer View */}
      {selectedRun ? (
        <section className="m3-detail-view-card">
          <div className="m3-detail-header">
            <div>
              <h2>{selectedRun.recipient}</h2>
            </div>
            <button
              type="button"
              className="m3-subtle-btn"
              onClick={() => setSelectedRun(null)}
            >
              ← Back to All Projects
            </button>
          </div>

          {/* Departure & Arrival Information Card */}
          <div className="m3-departure-info-grid">
            <div className="m3-info-tile">
              <span className="m3-tile-label">WHO LEFT (DEPARTING)</span>
              <strong className="m3-tile-val">
                {selectedRun.departingPerson || selectedRun.githubUsername || 'Unspecified'}
              </strong>
              {selectedRun.githubUsername && (
                <small>@{selectedRun.githubUsername}</small>
              )}
            </div>

            <div className="m3-info-tile">
              <span className="m3-tile-label">WHO JOINED (SUCCESSOR)</span>
              <strong className="m3-tile-val">{selectedRun.successorEmail ?? 'Unassigned'}</strong>
              <small>Incoming Developer</small>
            </div>

            <div className="m3-info-tile">
              <span className="m3-tile-label">TARGET ROLE</span>
              <strong className="m3-tile-val">
                {selectedRun.targetRole || 'Platform Engineer'}
              </strong>
              <small>{selectedRun.takeoverScope ? `Scope: ${selectedRun.takeoverScope}` : 'Full scope'}</small>
            </div>

            <div className="m3-info-tile">
              <span className="m3-tile-label">STATUS</span>
              <span className={`status-pill ${selectedRun.state === 'approved' ? 'valid' : 'uncertain'}`}>
                {selectedRun.state.replaceAll('_', ' ')}
              </span>
              <small>{new Date(selectedRun.createdAt).toLocaleDateString()}</small>
            </div>
          </div>

          {/* Handover Markdown Viewer */}
          <div className="m3-markdown-container">
            <div className="m3-markdown-bar">
              <strong>Shared Handover Documentation (rev-handover.md)</strong>
              <div className="m3-markdown-actions">
                <button
                  type="button"
                  className="m3-subtle-btn"
                  onClick={() => onOpenRunInWizard(selectedRun.id)}
                >
                  Edit in Studio
                </button>
                {selectedRun.state === 'approved' && (
                  <a
                    href={`/api/runs/${selectedRun.id}/export`}
                    download="rev-handover.md"
                    className="m3-primary-pill-btn sm m3e-button"
                  >
                    Download .md
                  </a>
                )}
              </div>
            </div>

            {markdownLoading ? (
              <div className="m3-loading-box">Loading handover document...</div>
            ) : markdownContent ? (
              <pre className="m3-markdown-body">{markdownContent}</pre>
            ) : (
              <div className="m3-notice-box">
                This run is currently in <strong>{selectedRun.state.replaceAll('_', ' ')}</strong> state.
                Complete review and approve in the Handover Studio to generate the finalized markdown export.
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="m3-project-index" data-tour-detail="projects">
          <header className="hero">
            <div>
              <h1>Projects &amp; runs</h1>
              <p>Review handovers and manage the local projects they draw from.</p>
            </div>
          </header>
          <div className="grid">
            <div className="column">
              {/* Active Handovers Grid */}
              <section className="card m3e-card m3e-card--outlined">
                <div className="card-head">
                  <div>
                    <h2>Handovers</h2>
                    <p>{loading ? "Loading runs" : `${runs.length} ${runs.length === 1 ? "run" : "runs"}`}</p>
                  </div>
                </div>

                {error && <div role="alert" className="error">{error}</div>}

                {loading ? (
                  <p>Loading projects...</p>
                ) : runs.length === 0 ? (
                  <div className="empty">
                    No handovers recorded yet.
                    <br />
                    <span>Click <b>New Handover</b> to capture knowledge from Git history.</span>
                  </div>
                ) : (
                  <div className="m3-cards-list">
                    {runs.map(r => (
                      <div
                        key={r.id}
                        className="m3-project-row-card"
                        onClick={() => viewProjectDetail(r)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={event => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void viewProjectDetail(r);
                          }
                        }}
                      >
                        <div className="m3-row-main">
                          <div className="m3-row-top">
                            <span className={`status-pill ${r.state === 'approved' ? 'valid' : 'uncertain'}`}>
                              {r.state.replaceAll('_', ' ')}
                            </span>
                            <span className="m3-row-date">{new Date(r.createdAt).toLocaleDateString()}</span>
                          </div>

                          <h3 className="m3-row-title">{r.recipient}</h3>

                          <div className="m3-row-meta">
                            <span><b>Departed:</b> {r.departingPerson || r.githubUsername || 'Maya Patel'}</span>
                            <span><b>Successor:</b> {r.successorEmail ?? 'Unassigned'}</span>
                            {r.targetRole && <span><b>Role:</b> {r.targetRole}</span>}
                          </div>
                        </div>

                        <div className="m3-row-arrow">
                          <span>{r.state === 'approved' ? 'Read handover' : 'Open run'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="column">
              {/* Local Daemon Project Monitor */}
              <ProjectDashboard />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
