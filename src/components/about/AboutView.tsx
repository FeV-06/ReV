'use client';

import { Check } from 'lucide-react';
import React from 'react';

export default function AboutView() {
  return (
    <div className="m3-about-container m3-slide-in">
      {/* Hero Section */}
      <section className="hero">
        <div>
          <div className="eyebrow">ABOUT REV · DESIGN & VERIFICATION PHILOSOPHY</div>
          <h1>
            A source, <em>not a guess.</em>
          </h1>
          <p>
            Engineering handovers fail when context lives only in Slack threads, forgotten PR comments, and tacit memory. ReV turns raw project history into evidence-backed, human-verified handover documentation.
          </p>
        </div>
        <div className="m3-core-badge">
          <strong>Rust Core + Next.js</strong>
          <small>Version 0.1.0 · Local Engine</small>
        </div>
      </section>

      <div className="grid">
        <div className="column">
          {/* Trust Principles */}
          <section className="card">
            <div className="card-head">
              <div>
                <div className="eyebrow">CORE PRINCIPLES</div>
                <h2>The Four Tenets of ReV</h2>
                <p>Designed from the ground up to prevent AI hallucinations in critical codebases.</p>
              </div>
            </div>

            <div className="m3-tenets-list">
              <div className="m3-tenet-item">
                <div className="m3-tenet-num">01</div>
                <div>
                  <strong>No Evidence, No Claim</strong>
                  <p>
                    Every sentence generated in a handover draft must be backed by an exact substring citation from a Git commit, pull request, or Slack discussion. If evidence is lacking, ReV highlights the gap instead of hallucinating.
                  </p>
                </div>
              </div>

              <div className="m3-tenet-item">
                <div className="m3-tenet-num">02</div>
                <div>
                  <strong>Strict Authorisation Scoping</strong>
                  <p>
                    Imported sources start unselected. Nothing is transmitted to any language model until the team lead explicitly reviews and authorizes which channels and commits are safe for the successor to receive.
                  </p>
                </div>
              </div>

              <div className="m3-tenet-item">
                <div className="m3-tenet-num">03</div>
                <div>
                  <strong>Human-in-the-Loop Sign-off</strong>
                  <p>
                    Edits made to claims are immediately marked unverified. Approvals require operator confirmation that the factual meaning, and not just the citation link, has been audited.
                  </p>
                </div>
              </div>

              <div className="m3-tenet-item">
                <div className="m3-tenet-num">04</div>
                <div>
                  <strong>Action-Oriented Day 1 Handoff</strong>
                  <p>
                    Rather than a passive wall of text, ReV extracts immediate Day-1 follow-ups, verified architecture decisions, and interactive checklists for the incoming engineer.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* System Architecture */}
          <section className="card">
            <div className="card-head">
              <div>
                <div className="eyebrow">UNDER THE HOOD</div>
                <h2>System Architecture</h2>
                <p>How ReV operates securely inside your environment.</p>
              </div>
            </div>

            <div className="m3-architecture-grid">
              <div className="m3-arch-box">
                <span className="m3-arch-tag">RUST ENGINE (`rev-core`)</span>
                <h4>Deterministic Citation Verification</h4>
                <p>
                  High-performance Rust crate compiled to native binaries that parses Git diffs, normalizes patches, prevents path traversals, and guarantees verbatim substring alignment.
                </p>
              </div>

              <div className="m3-arch-box">
                <span className="m3-arch-tag">BACKGROUND DAEMON</span>
                <h4>Local Project Watcher</h4>
                <p>
                  A lightweight Node.js daemon running on <code>127.0.0.1:3077</code> monitoring registered Git repositories for uncommitted changes, branches, and author activity.
                </p>
              </div>

              <div className="m3-arch-box">
                <span className="m3-arch-tag">STORAGE LAYER</span>
                <h4>PGlite & PostgreSQL</h4>
                <p>
                  Runs embedded WASM PostgreSQL via PGlite for zero-install local operation, with clean migration paths to remote PostgreSQL databases.
                </p>
              </div>

              <div className="m3-arch-box">
                <span className="m3-arch-tag">SECURITY BOUNDARY</span>
                <h4>Loopback Isolation</h4>
                <p>
                  All network bindings are strictly restricted to <code>127.0.0.1</code>. ReV does not expose public ports or transmit unauthorized telemetry.
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* Right Sidebar: Security & Specs */}
        <div className="column">
          <section className="card compact trust">
            <div className="eyebrow">SECURITY GUARANTEES</div>
            <h3>Air-Gap & Local Privacy</h3>
            <p>
              Your source code and internal conversations never leave your control without explicit consent.
            </p>
            <div className="trust-line">
              <span><Check size={16} aria-hidden="true" /></span> Zero remote telemetry
            </div>
            <div className="trust-line">
              <span><Check size={16} aria-hidden="true" /></span> Local-first credential storage
            </div>
            <div className="trust-line">
              <span><Check size={16} aria-hidden="true" /></span> Offline LLM support via Ollama
            </div>
            <div className="trust-line">
              <span><Check size={16} aria-hidden="true" /></span> Strict Cross-Origin Request blocking
            </div>
          </section>

          <section className="card compact">
            <div className="eyebrow">DESIGN SYSTEM</div>
            <h3>Material 3 Expressive</h3>
            <p>
              Styled using Google’s Material 3 Expressive guidelines:
            </p>
            <ul style={{ paddingLeft: '20px', color: 'var(--muted)', fontSize: '13px', lineHeight: '1.8' }}>
              <li>Full-radius pill action controls (<code>9999px</code>)</li>
              <li>High-contrast green tonal container hierarchy</li>
              <li>Low-glare reading canvas (<code>#f5f7f2</code>)</li>
              <li>Editorial headings with <i>DM Serif Display</i></li>
              <li>Interactive evidence drawers and progress tracks</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

