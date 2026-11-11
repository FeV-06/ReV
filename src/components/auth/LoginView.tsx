'use client';

import React, { useState } from 'react';
import { useAuth, UserRole } from '@/lib/auth-context';

/**
 * Technical DAG Background
 * Directed Acyclic Graph composed of crisp vector edges with arrowheads
 * clustered in the upper-right and lower-left quadrants so the central
 * typography remains pristine and legible.
 */
function DagBackground() {
  return (
    <div className="auth-dag-canvas">
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 1000 800"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <marker
            id="dag-arrow-strong"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto"
          >
            <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#174a3d" fillOpacity="0.65" />
          </marker>
          <marker
            id="dag-arrow-soft"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#174a3d" fillOpacity="0.28" />
          </marker>
        </defs>

        {/* Top-Right DAG Cluster */}
        <g stroke="#174a3d" strokeOpacity="0.14" strokeWidth="1.2" markerEnd="url(#dag-arrow-soft)">
          <line x1="440" y1="185" x2="575" y2="115" />
          <line x1="440" y1="185" x2="540" y2="275" />
          <line x1="540" y1="275" x2="645" y2="205" />
          <line x1="540" y1="275" x2="600" y2="380" />
          <line x1="600" y1="380" x2="705" y2="305" />
          <line x1="575" y1="115" x2="735" y2="20" />
        </g>

        <g stroke="#174a3d" strokeOpacity="0.45" strokeWidth="1.35" markerEnd="url(#dag-arrow-strong)">
          <line x1="575" y1="115" x2="650" y2="195" />
          <line x1="650" y1="195" x2="738" y2="215" />
          <line x1="650" y1="195" x2="682" y2="292" />
          <line x1="682" y1="292" x2="795" y2="265" />
          <line x1="738" y1="215" x2="845" y2="175" />
          <line x1="738" y1="215" x2="795" y2="265" />
          <line x1="795" y1="265" x2="825" y2="365" />
          <line x1="845" y1="175" x2="825" y2="365" />
          <line x1="845" y1="175" x2="985" y2="115" />
          <line x1="845" y1="175" x2="915" y2="295" />
          <line x1="825" y1="365" x2="905" y2="475" />
          <line x1="915" y1="295" x2="990" y2="245" />
          <line x1="915" y1="295" x2="905" y2="475" />
          <line x1="905" y1="475" x2="995" y2="435" />
          <line x1="735" y1="20" x2="845" y2="175" />
          <line x1="735" y1="20" x2="740" y2="210" />
        </g>

        {/* Nodes */}
        <g fill="#174a3d">
          <circle cx="440" cy="185" r="3.5" fillOpacity="0.18" />
          <circle cx="540" cy="275" r="3.5" fillOpacity="0.18" />
          <circle cx="600" cy="380" r="3.5" fillOpacity="0.18" />
          <circle cx="575" cy="115" r="4" fillOpacity="0.28" />
          <circle cx="735" cy="20" r="4" fillOpacity="0.28" />
          <circle cx="650" cy="195" r="4.5" fillOpacity="0.6" />
          <circle cx="682" cy="292" r="4.5" fillOpacity="0.45" />
          <circle cx="738" cy="215" r="5" fillOpacity="0.75" />
          <circle cx="795" cy="265" r="5" fillOpacity="0.75" />
          <circle cx="845" cy="175" r="5.5" fillOpacity="0.85" />
          <circle cx="825" cy="365" r="4.5" fillOpacity="0.6" />
          <circle cx="915" cy="295" r="5" fillOpacity="0.7" />
          <circle cx="905" cy="475" r="4.5" fillOpacity="0.55" />
        </g>

        {/* Bottom-Left DAG Cluster */}
        <g stroke="#174a3d" strokeOpacity="0.18" strokeWidth="1.2" markerEnd="url(#dag-arrow-soft)">
          <line x1="0" y1="485" x2="105" y2="520" />
          <line x1="0" y1="620" x2="105" y2="520" />
          <line x1="320" y1="570" x2="430" y2="570" />
          <line x1="430" y1="570" x2="545" y2="625" />
          <line x1="430" y1="570" x2="430" y2="710" />
          <line x1="545" y1="625" x2="585" y2="740" />
          <line x1="430" y1="710" x2="545" y2="780" />
        </g>

        <g stroke="#174a3d" strokeOpacity="0.42" strokeWidth="1.35" markerEnd="url(#dag-arrow-strong)">
          <line x1="105" y1="520" x2="168" y2="605" />
          <line x1="105" y1="520" x2="155" y2="668" />
          <line x1="0" y1="685" x2="155" y2="668" />
          <line x1="168" y1="605" x2="320" y2="570" />
          <line x1="168" y1="605" x2="290" y2="645" />
          <line x1="155" y1="668" x2="290" y2="645" />
          <line x1="155" y1="668" x2="345" y2="720" />
          <line x1="290" y1="645" x2="430" y2="570" />
          <line x1="290" y1="645" x2="345" y2="720" />
          <line x1="345" y1="720" x2="430" y2="710" />
        </g>
      </svg>
    </div>
  );
}

function EvaluationGateways() {
  const { loginAsSuperuser } = useAuth();
  const [showAltAuth, setShowAltAuth] = useState(false);
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('admin');
  const [error, setError] = useState('');

  const { loginWithCredentials } = useAuth();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Please fill in email and password.');
      return;
    }
    if (tab === 'signup' && !name) {
      setError('Please provide your name.');
      return;
    }
    loginWithCredentials(
      tab === 'signup' ? name : email.split('@')[0],
      email,
      selectedRole
    );
  }

  return (
    <div className="m3-auth-card w-full">
      {/* Brand Header */}
      <div className="m3-auth-header">
        <div className="m3-auth-brand-mark" aria-hidden="true">R</div>
        <h1 className="m3-auth-title">ReV</h1>
        <p className="m3-auth-tagline">Evidence-Backed Developer Handover Engine</p>
      </div>

      <div className="m3-eval-intro">
        <span className="m3-eval-eyebrow">HACKATHON EVALUATION GATEWAY</span>
        <h3>Select Evaluation Experience</h3>
        <p>
          Switch modes anytime via the persistent header toggle.
        </p>
      </div>

      {/* Gateway Cards Grid */}
      <div className="m3-eval-grid">
        {/* Gateway 1: Demo Mode */}
        <div className="m3-eval-card demo-card">
          <div className="m3-eval-card-header">
            <span className="m3-eval-pill demo">⚡ INSTANT DEMO</span>
            <span className="m3-eval-subtag">0s Latency · Guided Walkthrough</span>
          </div>
          <h4>Instant Guided Showcase</h4>
          <p>
            Zero-latency walkthrough across all 4 stages. Demonstrates Tree-Sitter AST symbols, exact citation verification, and interactive Departure Interview Q&A with real-time UI spotlights.
          </p>
          <div className="m3-eval-actions">
            <button
              type="button"
              className="m3-eval-btn primary"
              onClick={() => loginAsSuperuser('admin', 'demo')}
              id="btn-eval-demo-admin"
            >
              <span>👑 Launch Admin Studio Demo</span>
              <span className="arrow">→</span>
            </button>
            <button
              type="button"
              className="m3-eval-btn tonal"
              onClick={() => loginAsSuperuser('developer', 'demo')}
              id="btn-eval-demo-dev"
            >
              <span>👤 Launch Successor Reader Demo</span>
              <span className="arrow">→</span>
            </button>
          </div>
        </div>

        {/* Gateway 2: Live Engine */}
        <div className="m3-eval-card live-card">
          <div className="m3-eval-card-header">
            <span className="m3-eval-pill live">🔬 LIVE ENGINE</span>
            <span className="m3-eval-subtag">gemini-3.8-flash-high</span>
          </div>
          <h4>Real GitHub & Native AST Engine</h4>
          <p>
            Connected to the local background daemon (:3078). Ingest any public GitHub repository, parse Tree-Sitter AST symbols in Rust, and synthesize handovers with live reasoning.
          </p>
          <div className="m3-eval-actions">
            <button
              type="button"
              className="m3-eval-btn live-btn"
              onClick={() => loginAsSuperuser('admin', 'live')}
              id="btn-eval-live-engine"
            >
              <span>🚀 Launch Live GitHub Studio</span>
              <span className="arrow">→</span>
            </button>
          </div>
          <div className="m3-eval-specs">
            <small>● Daemon: Connected</small>
            <small>● AST: Tree-Sitter Core</small>
            <small>● Model: OmniRoute :20128</small>
          </div>
        </div>
      </div>

      {/* Alternative Access Toggle */}
      <div className="m3-alt-auth-section">
        <button
          type="button"
          className="m3-alt-toggle-btn"
          onClick={() => setShowAltAuth(prev => !prev)}
          aria-expanded={showAltAuth}
        >
          <span>{showAltAuth ? '▾ Hide standard login & interview options' : '▸ Alternative: Departing Teammate Interview or Custom Login'}</span>
        </button>

        {showAltAuth && (
          <div className="m3-alt-auth-content m3-slide-in">
            <div className="m3-fast-dev-grid" style={{ marginBottom: '16px' }}>
              <button
                type="button"
                className="m3-fast-access-card dev"
                onClick={() => loginAsSuperuser('departing', 'demo')}
              >
                <div className="m3-access-icon" aria-hidden="true">✎</div>
                <div className="m3-access-info">
                  <strong>Departing Teammate</strong>
                  <small>Open interview questions and record answers</small>
                </div>
                <div className="m3-access-arrow" aria-hidden="true">→</div>
              </button>
            </div>

            <div className="m3-segmented-control" role="tablist">
              <button
                type="button"
                className={`m3-segment-btn ${tab === 'signin' ? 'active' : ''}`}
                onClick={() => { setTab('signin'); setError(''); }}
                role="tab"
                aria-selected={tab === 'signin'}
              >
                Sign In
              </button>
              <button
                type="button"
                className={`m3-segment-btn ${tab === 'signup' ? 'active' : ''}`}
                onClick={() => { setTab('signup'); setError(''); }}
                role="tab"
                aria-selected={tab === 'signup'}
              >
                Create Account
              </button>
            </div>

            {error && <div role="alert" className="m3-auth-error">{error}</div>}

            <form onSubmit={handleSubmit} className="m3-form-stack">
              {tab === 'signup' && (
                <div className="m3-field">
                  <label htmlFor="auth-name">Full Name</label>
                  <input
                    id="auth-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Jordan Rivera"
                    required
                  />
                </div>
              )}

              <div className="m3-field">
                <label htmlFor="auth-email">Work Email</label>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@team.internal"
                  required
                />
              </div>

              <div className="m3-field">
                <label htmlFor="auth-password">Password</label>
                <input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>

              <div className="m3-field">
                <label htmlFor="auth-role">Role</label>
                <select
                  id="auth-role"
                  value={selectedRole}
                  onChange={e => setSelectedRole(e.target.value as UserRole)}
                >
                  <option value="admin">👑 Admin / Tech Lead (Creator & Auditor)</option>
                  <option value="developer">👤 Successor Developer (Onboarder)</option>
                </select>
              </div>

              <button type="submit" className="m3-auth-submit-btn">
                {tab === 'signin' ? 'Sign In to Workspace →' : 'Create Account & Enter →'}
              </button>
            </form>
          </div>
        )}
      </div>

      <div className="m3-auth-footer">
        <span>Local Engine · Zero external telemetry · Material 3 Expressive</span>
      </div>
    </div>
  );
}

/**
 * Full-Bleed Split-Screen Authentication Page
 */
export default function LoginView() {
  return (
    <div className="h-screen w-screen flex overflow-hidden auth-split-container">
      {/* Left Pane (45% - The Hero & DAG Background) */}
      <div className="hidden lg:flex lg:w-[45%] relative flex-col justify-center items-center overflow-hidden bg-[#f3f0e8] auth-split-left">
        <DagBackground />

        <div className="auth-hero-container">
          <h1 className="auth-hero-title">
            Knowledge,
            <br />
            <span className="auth-hero-accent">carried forward.</span>
          </h1>
          <p style={{ marginTop: '14px', fontSize: '12pt', color: '#3d5248', maxWidth: '380px', lineHeight: 1.5 }}>
            Turning fragmented codebases and departing engineer context into verifiable, cited handovers.
          </p>
        </div>
      </div>

      {/* Right Pane (55% - The Gateways Slot) */}
      <div className="w-full lg:w-[55%] h-full bg-white flex flex-col items-center relative z-20 shadow-[-10px_0_30px_rgba(0,0,0,0.03)] overflow-y-auto px-6 py-8 auth-split-right">
        <div className="w-full max-w-xl auth-form-wrapper">
          <EvaluationGateways />
        </div>
      </div>
    </div>
  );
}
