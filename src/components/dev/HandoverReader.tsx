'use client';

import { BookOpen, Download, Files, Link, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import type { Run, Artifact } from '@/lib/contracts';
import DayOneChecklist from '@/components/dev/DayOneChecklist';
import HandoverAssistant from '@/components/dev/HandoverAssistant';
import MarkdownDocumentViewer from '@/components/MarkdownDocumentViewer';

interface HandoverReaderProps {
  run: Run;
  markdownText?: string;
  onBack: () => void;
}

export default function HandoverReader({ run, markdownText, onBack }: HandoverReaderProps) {
  const [activeEvidence, setActiveEvidence] = useState<Artifact | null>(null);
  const [readingMode, setReadingMode] = useState<'document' | 'cards'>('document');
  const drawer = useRef<HTMLDialogElement>(null);
  const includedItems = run.items.filter(item => !item.excluded);
  const showDocument = readingMode === 'document' && Boolean(markdownText);

  useEffect(() => {
    const dialog = drawer.current;
    if (activeEvidence && dialog && !dialog.open) dialog.showModal();
  }, [activeEvidence]);

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
        <button type="button" className="secondary m3e-button m3e-button--tonal" onClick={onBack}>
          ← Back to My Handovers
        </button>
        <div className="m3-reader-actions">
          {run.state === 'approved' && (
            <button
              type="button"
              onClick={handleDownload}
              className="m3-download-button"
            >
              <Download size={16} aria-hidden="true" /> Download Handover (.md)
            </button>
          )}
        </div>
      </div>

      {/* Hero Departure Banner */}
      <section className="card m3e-card m3e-card--outlined m3-departure-banner">
        <div className="card-head">
          <div>
            <h1>{run.recipient}</h1>
            <p>Complete project context, operational knowledge, and verified evidence.</p>
          </div>
          <span className="status-pill valid">{run.state === 'approved' ? 'Approved' : run.state.replaceAll('_', ' ')}</span>
        </div>

        <div className="m3-departure-grid">
          <div className="m3-dep-card">
            <span className="m3-micro-label">Handed over by</span>
            <strong>{run.departingPerson || run.githubUsername || 'Unspecified'}</strong>
            {run.githubUsername && <small>GitHub: @{run.githubUsername}</small>}
          </div>

          <div className="m3-dep-card">
            <span className="m3-micro-label">Successor</span>
            <strong>{run.successorEmail ?? 'Unassigned'}</strong>
          </div>

          <div className="m3-dep-card">
            <span className="m3-micro-label">Target role</span>
            <strong>{run.targetRole || 'Unspecified'}</strong>
            <small>{run.takeoverScope ? `Scope: ${run.takeoverScope}` : 'Full scope'}</small>
          </div>

          <div className="m3-dep-card">
            <span className="m3-micro-label">Evidence sources</span>
            <strong>{run.selectedIds.length} selected sources</strong>
            <small>{run.items.filter(i => !i.excluded).length} included claims</small>
          </div>
        </div>
      </section>

      {/* Two Column Layout: Main Markdown & Claims | Interactive Day-1 Checklist */}
      <div className="m3-reader-layout">
        <div className="m3-reader-main">
          {/* Formatted Claims & Sections with Interactive Citation Badges */}
          <section className="card m3e-card m3e-card--outlined m3-reader-content">
            <div className="card-head">
              <div>
                <h2>Handover</h2>
                <p>Read the document or open a source to check a claim.</p>
              </div>

              {/* Reading Mode Segmented Control */}
              {markdownText && <div className="m3-segmented-control-mini" role="group" aria-label="Handover view">
                <button
                  type="button"
                  className={`m3-mini-tab ${readingMode === 'document' ? 'active' : ''}`}
                  onClick={() => setReadingMode('document')}
                  aria-pressed={showDocument}
                >
                  <BookOpen size={16} aria-hidden="true" /> Document
                </button>
                <button
                  type="button"
                  className={`m3-mini-tab ${readingMode === 'cards' ? 'active' : ''}`}
                  onClick={() => setReadingMode('cards')}
                  aria-pressed={!showDocument}
                >
                  <Files size={16} aria-hidden="true" /> Evidence
                </button>
              </div>}
            </div>

            {showDocument && markdownText ? (
              <div style={{ marginTop: '16px' }}>
                <MarkdownDocumentViewer
                  markdown={markdownText}
                  filename={`handover-${(run.departingPerson || 'project').toLowerCase()}.md`}
                  onDownload={handleDownload}
                />
              </div>
            ) : includedItems.length ? (
              <div className="m3-claims-flow">
                {includedItems
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
                                <span className="m3-cite-icon"><Link size={16} aria-hidden="true" /></span>
                                <span className="m3-cite-ref">{src?.sourceRef || 'Source'}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            ) : <p>No claims are included in this handover.</p>}
          </section>
        </div>

        {/* Sidebar: Day-1 Checklist & Quick Guide */}
        <aside className="m3-reader-sidebar">
          <DayOneChecklist projectId={run.id} initialTasks={checklistTasks} />
          {run.state === 'approved' && <HandoverAssistant key={run.id} run={run} />}

        </aside>
      </div>

      {/* SLIDE-OVER EVIDENCE DRAWER */}
      {activeEvidence && (
        <dialog ref={drawer} className="m3-evidence-drawer" aria-labelledby="evidence-drawer-title"
          onClose={() => setActiveEvidence(null)} onClick={event => {
            if (event.target === event.currentTarget) event.currentTarget.close();
          }}>
          <div className="m3-evidence-drawer-content">
            <div className="m3-drawer-header">
              <div>
                <h2 id="evidence-drawer-title">Source excerpt</h2>
                <span>{activeEvidence.kind.replaceAll('_', ' ')}</span>
              </div>
              <button
                type="button"
                className="m3-drawer-close"
                onClick={() => drawer.current?.close()}
                aria-label="Close evidence drawer"
              >
                <X size={16} aria-hidden="true" />
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

            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}

