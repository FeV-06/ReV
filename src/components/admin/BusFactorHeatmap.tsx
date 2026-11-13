'use client';

import React, { useState } from 'react';
import type { ModuleRisk } from '@/lib/server/risk';

interface BusFactorHeatmapProps {
  runId: string;
  departingName?: string;
}

export default function BusFactorHeatmap({ runId, departingName }: BusFactorHeatmapProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modules, setModules] = useState<ModuleRisk[] | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'high' | 'moderate'>('all');

  async function loadRisk() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/risk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Rev-Request': '1' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to analyze repository risk');
      setModules(data.analysis.modules);
      setRevision(data.analysis.revision);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function getFragilityBadge(score: number, fraction: number) {
    if (score >= 2.0 || fraction >= 0.7) {
      return { label: 'CRITICAL', className: 'm3-pill-error', bg: '#fff0ed', color: '#9b4639', border: '#f7c5bd' };
    }
    if (score >= 0.8 || fraction >= 0.4) {
      return { label: 'MODERATE', className: 'm3-pill-warning', bg: '#fff7e7', color: '#805d1d', border: '#fce2ad' };
    }
    return { label: 'LOW', className: 'm3-pill-success', bg: '#e6f4ea', color: '#1b633b', border: '#b6dfc4' };
  }

  const filteredModules = (modules || []).filter((m) => {
    if (filter === 'high') return m.score >= 2.0 || m.ownershipFraction >= 0.7;
    if (filter === 'moderate') return m.score >= 0.8 || m.ownershipFraction >= 0.4;
    return true;
  });

  return (
    <section className="card bus-factor-heatmap-card" style={{ marginTop: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <div className="eyebrow" style={{ color: '#174a3d', fontWeight: 700, letterSpacing: '0.05em' }}>
            ROUND 3 KNOWLEDGE RISK &amp; BUS FACTOR
          </div>
          <h3 style={{ margin: '4px 0', fontSize: '18px', color: '#0f352b' }}>
            Repository Ownership &amp; Module Fragility Heatmap
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#5c6f66' }}>
            Combines Git blame ownership with 90-day churn to pinpoint fragile modules concentrated in {departingName ? `"${departingName}"` : 'the departing contributor'}.
          </p>
        </div>

        <div>
          {!modules && !loading && (
            <button
              type="button"
              className="primary"
              onClick={loadRisk}
              style={{
                background: '#174a3d',
                color: '#fff',
                padding: '8px 18px',
                borderRadius: '9999px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                border: 'none',
                boxShadow: '0 2px 6px rgba(23,74,61,0.2)',
              }}
            >
              Analyze Bus-Factor Heatmap →
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div style={{ padding: '24px', textAlign: 'center', color: '#174a3d' }}>
          <div className="m3-processing-spinner" style={{ margin: '0 auto 12px' }} />
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
            Analyzing repository Git blame ownership &amp; 90-day churn...
          </p>
          <small style={{ color: '#5c6f66' }}>Calculating uncalibrated fragility heuristics via Rust core</small>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            marginTop: '14px',
            padding: '10px 14px',
            background: '#fff0ed',
            border: '1px solid #f7c5bd',
            borderRadius: '8px',
            color: '#9b4639',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {modules && (
        <div style={{ marginTop: '16px' }}>
          {/* Summary Metric Ribbon */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
              marginBottom: '16px',
            }}
          >
            <div style={{ background: '#f5f7f2', padding: '10px 14px', borderRadius: '10px', border: '1px solid #dbe5dd' }}>
              <div style={{ fontSize: '11px', color: '#5c6f66', textTransform: 'uppercase', fontWeight: 700 }}>Tracked Modules</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#0f352b' }}>{modules.length}</div>
            </div>

            <div style={{ background: '#fff0ed', padding: '10px 14px', borderRadius: '10px', border: '1px solid #f7c5bd' }}>
              <div style={{ fontSize: '11px', color: '#9b4639', textTransform: 'uppercase', fontWeight: 700 }}>Critical Concentration</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#9b4639' }}>
                {modules.filter((m) => m.ownershipFraction >= 0.7).length}
              </div>
            </div>

            <div style={{ background: '#f7faf7', padding: '10px 14px', borderRadius: '10px', border: '1px solid #d9ebda' }}>
              <div style={{ fontSize: '11px', color: '#174a3d', textTransform: 'uppercase', fontWeight: 700 }}>HEAD Revision</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#174a3d', fontFamily: 'monospace' }}>
                {revision ? revision.slice(0, 10) : 'Latest'}
              </div>
            </div>
          </div>

          {/* Filter Pills */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: '#5c6f66', fontWeight: 600 }}>Filter by Risk:</span>
            {(['all', 'high', 'moderate'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setFilter(mode)}
                style={{
                  background: filter === mode ? '#174a3d' : '#f5f7f2',
                  color: filter === mode ? '#fff' : '#174a3d',
                  border: '1px solid #dbe5dd',
                  borderRadius: '9999px',
                  padding: '3px 12px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {mode === 'all' ? 'All Modules' : mode === 'high' ? 'High Risk Only' : 'Moderate & Above'}
              </button>
            ))}
          </div>

          {/* Module Heatmap Table */}
          <div style={{ overflowX: 'auto', border: '1px solid #dbe5dd', borderRadius: '10px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#eaf1ec', borderBottom: '1px solid #dbe5dd' }}>
                  <th style={{ padding: '8px 12px', color: '#0f352b' }}>File / Module Path</th>
                  <th style={{ padding: '8px 12px', color: '#0f352b', width: '120px' }}>Ownership %</th>
                  <th style={{ padding: '8px 12px', color: '#0f352b', width: '100px' }}>90-Day Churn</th>
                  <th style={{ padding: '8px 12px', color: '#0f352b', width: '100px' }}>Fragility Level</th>
                </tr>
              </thead>
              <tbody>
                {filteredModules.map((m) => {
                  const badge = getFragilityBadge(m.score, m.ownershipFraction);
                  const percent = Math.round(m.ownershipFraction * 100);
                  return (
                    <tr key={m.path} style={{ borderBottom: '1px solid #eef2ef' }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 600, color: '#17211d' }}>
                        {m.path}
                        <div style={{ fontSize: '10px', color: '#5c6f66', fontWeight: 400 }}>
                          {m.departingLines} of {m.totalLines} lines owned
                        </div>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ flex: 1, height: '6px', background: '#eaf1ec', borderRadius: '4px', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${percent}%`,
                                height: '100%',
                                background: percent >= 70 ? '#9b4639' : percent >= 40 ? '#805d1d' : '#1b633b',
                              }}
                            />
                          </div>
                          <span style={{ fontSize: '11px', fontWeight: 700, minWidth: '32px' }}>{percent}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '8px 12px', color: '#3d5248' }}>
                        +{m.churnLines} lines
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            background: badge.bg,
                            color: badge.color,
                            border: `1px solid ${badge.border}`,
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            fontSize: '10px',
                            fontWeight: 700,
                            letterSpacing: '0.04em',
                          }}
                        >
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
