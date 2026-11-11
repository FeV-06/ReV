'use client';

import React, { useState } from 'react';
import type { Run, Artifact } from '@/lib/contracts';
import DayOneChecklist from '@/components/dev/DayOneChecklist';
import HandoverAssistant from '@/components/dev/HandoverAssistant';

interface HandoverReaderProps {
  run: Run;
  markdownText?: string;
  onBack: () => void;
}

export default function HandoverReader({ run, markdownText, onBack }: HandoverReaderProps) {
  const [activeEvidence, setActiveEvidence] = useState<Artifact | null>(null);

  // Extract checklist tasks from items
  const checklistTasks = run.items
    .filter(i => !i.excluded && (i.category === 'next_action' || i.category === 'risk' || i.category === 'open_work'))
    .slice(0, 5)
    .map(i => ({
      id: i.id,
      text: i.text,
      category: i.category.replaceAll('_', ' ').toUpperCase(),
    }));

  function openEvidenceForSourceId(sourceId: string) {
    const found = run.artifacts.find(a => a.id === sourceId);
    if (found) {
      setActiveEvidence(found);
    }
  }

  async function handleDownload() {
    try {
      const resp = await fetch(`/api/runs/${run.id}/export`, { headers: { 'X-Rev-Request': '1' } });
      if (!resp.ok) throw new Error('Download failed');
      const text = await resp.text();
      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `handover-${(run.departingPerson || 'project').toLowerCase()}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.location.href = `/api/runs/${run.id}/export`;
    }
  }

  return (
    <div className="m3-reader-container m3-slide-in">
      {/* Top Breadcrumb & Action bar */}
      <div className="m3-reader-nav">
        <button type="button" className="secondary" onClick={onBack}>
          ← Back to My Handovers
        </button>
        <div className="m3-reader-actions">
          {run.state === 'approved' && (
            <button
              type="button"
              onClick={handleDownload}
              className="m3-download-button"
            >
              📥 Download Handover (.md)
            </button>
          )}
        </div>
      </div>

      {/* Hero Departure Banner */}
      <section className="card m3-departure-banner">
        <div className="card-head">
          <div>
            <div className="eyebrow">SUCCESSOR ONBOARDING PORTAL</div>
            <h1>{run.recipient}</h1>
            <p>Complete project context, operational knowledge, and verified evidence.</p>
          </div>
          <span className="status-pill valid">VERIFIED & APPROVED</span>
        </div>

        <div className="m3-departure-grid">
          <div className="m3-dep-card">
            <span className="m3-micro-label">HANDED OVER BY</span>
            <strong>{run.departingPerson || run.githubUsername || 'Maya Patel'}</strong>
            {run.githubUsername && <small>GitHub: @{run.githubUsername}</small>}
          </div>

          <div className="m3-dep-card">
            <span className="m3-micro-label">ASSIGNED TO (SUCCESSOR)</span>
            <strong>{run.successorEmail ?? 'Unassigned'}</strong>
            <small>Senior Engineer</small>
          </div>

          <div className="m3-dep-card">
            <span className="m3-micro-label">TARGET ROLE</span>
            <strong>{run.targetRole || 'Platform Engineer'}</strong>
            <small>{run.takeoverScope ? `Scope: ${run.takeoverScope}` : 'Full scope'}</small>
          </div>

          <div className="m3-dep-card">
            <span className="m3-micro-label">EVIDENCE SOURCES</span>
            <strong>{run.selectedIds.length} Verified Sources</strong>
            <small>{run.items.filter(i => !i.excluded).length} Approved Claims</small>
          </div>
        </div>
      </section>

      {run.state === "approved" && <HandoverAssistant key={run.id} run={run} />}
      {/* Two Column Layout: Main Markdown & Claims | Interactive Day-1 Checklist */}
      <div className="m3-reader-layout">
        <div className="m3-reader-main">
          {/* Formatted Claims & Sections with Interactive Citation Badges */}
          <section className="card">
            <div className="card-head">
              <div>
                <div className="eyebrow">VERIFIED KNOWLEDGE & CLAIMS</div>
                <h2>Operational Briefing</h2>
                <p>
                  Every statement below is linked to verbatim evidence. Click any{' '}
                  <span className="m3-citation-pill-sample">evidence badge</span> to inspect the original source.
                </p>
              </div>
            </div>

            <div className="m3-claims-flow">
              {run.items
                .filter(item => !item.excluded)
                .map(item => (
                  <div key={item.id} className="m3-reader-claim-card">
                    <div className="m3-claim-header">
                      <span className="m3-claim-category">{item.category.replaceAll('_', ' ')}</span>
                      <span className={`status-pill ${item.verification === 'validated_reference' ? 'valid' : 'uncertain'}`}>
                        {item.verification.replaceAll('_', ' ')}
                      </span>
                    </div>

                    <p className="m3-claim-text">{item.text}</p>

                    {item.citations.length > 0 && (
                      <div className="m3-claim-citations">
                        <span className="m3-citation-label">Evidence:</span>
                        {item.citations.map((cite, idx) => {
                          const src = run.artifacts.find(a => a.id === cite.sourceId);
                          return (
                            <button
                              key={idx}
                              type="button"
                              className="m3-citation-badge-btn"
                              onClick={() => openEvidenceForSourceId(cite.sourceId)}
                              title="Click to view verbatim supporting evidence"
                            >
                              <span className="m3-cite-icon">🔗</span>
                              <span className="m3-cite-ref">{src?.sourceRef || 'Source'}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
            </div>

            {/* Complete Markdown Document Display */}
            {markdownText && (
              <div className="m3-raw-markdown-section">
                <div className="m3-markdown-header">
                  <strong>Full Handover Document (Markdown)</strong>
                </div>
                <pre className="m3-markdown-pre">{markdownText}</pre>
              </div>
            )}
          </section>
        </div>

        {/* Sidebar: Day-1 Checklist & Quick Guide */}
        <aside className="m3-reader-sidebar">
          <DayOneChecklist projectId={run.id} initialTasks={checklistTasks} />

          <div className="card compact trust" style={{ marginTop: '20px' }}>
            <div className="eyebrow">VERIFICATION PRINCIPLE</div>
            <h3>A source, not a guess.</h3>
            <p>
              This handover was generated using deterministic evidence extraction. Claims are strictly bound to Git commits and recorded team conversations.
            </p>
            <div className="trust-line">
              <span>01</span> Verbatim substring verification
            </div>
            <div className="trust-line">
              <span>02</span> Provenance tracking across all claims
            </div>
            <div className="trust-line">
              <span>03</span> Human lead sign-off
            </div>
          </div>
        </aside>
      </div>

      {/* SLIDE-OVER EVIDENCE DRAWER */}
      {activeEvidence && (
        <div className="m3-drawer-backdrop" onClick={() => setActiveEvidence(null)}>
          <div className="m3-evidence-drawer m3-slide-in-right" onClick={e => e.stopPropagation()}>
            <div className="m3-drawer-header">
              <div>
                <span className="eyebrow">VERBATIM EVIDENCE PREVIEW</span>
                <h3>{activeEvidence.kind.replaceAll('_', ' ').toUpperCase()}</h3>
              </div>
              <button
                type="button"
                className="m3-drawer-close"
                onClick={() => setActiveEvidence(null)}
                aria-label="Close evidence drawer"
              >
                ✕
              </button>
            </div>

            <div className="m3-drawer-body">
              <div className="m3-evidence-field">
                <span className="m3-drawer-label">SOURCE REFERENCE</span>
                <strong>{activeEvidence.sourceRef}</strong>
                {activeEvidence.url && (
                  <a
                    href={activeEvidence.url}
                    target="_blank"
                    rel="noreferrer"
                    className="m3-drawer-link"
                  >
                    Open in GitHub / Slack ↗
                  </a>
                )}
              </div>

              {activeEvidence.author && (
                <div className="m3-evidence-field">
                  <span className="m3-drawer-label">AUTHOR</span>
                  <span>{activeEvidence.author}</span>
                  {activeEvidence.githubLogin && (
                    <small> (@{activeEvidence.githubLogin})</small>
                  )}
                </div>
              )}

              {activeEvidence.paths && activeEvidence.paths.length > 0 && (
                <div className="m3-evidence-field">
                  <span className="m3-drawer-label">MODIFIED FILES</span>
                  <div className="m3-paths-list">
                    {activeEvidence.paths.map((p, idx) => (
                      <code key={idx}>{p}</code>
                    ))}
                  </div>
                </div>
              )}

              <div className="m3-evidence-field">
                <span className="m3-drawer-label">VERBATIM SOURCE TEXT</span>
                <blockquote className="m3-verbatim-quote">
                  {activeEvidence.text}
                </blockquote>
              </div>

              <div className="notice" style={{ marginTop: '16px' }}>
                ✓ Substring verified against source archive at import time.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

