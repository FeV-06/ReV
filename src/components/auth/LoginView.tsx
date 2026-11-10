'use client';

import React, { useState } from 'react';
import { useAuth, UserRole } from '@/lib/auth-context';

export default function LoginView() {
  const { loginAsSuperuser, loginWithCredentials } = useAuth();
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('admin');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }
    if (tab === 'signup' && !name.trim()) {
      setError('Please enter your full name.');
      return;
    }

    loginWithCredentials(
      tab === 'signup' ? name.trim() : email.split('@')[0],
      email.trim(),
      selectedRole
    );
  }

  return (
    <div className="m3-auth-page">
      <div className="m3-auth-card">
        {/* Brand Header */}
        <div className="m3-auth-header">
          <div className="m3-auth-brand-mark" aria-hidden="true">R</div>
          <h1 className="m3-auth-title">ReV</h1>
          <p className="m3-auth-tagline">Knowledge, carried forward</p>
        </div>

        {/* Superuser Fast Dev Access Section */}
        <div className="m3-fast-dev-box">
          <div className="m3-fast-dev-header">
            <span className="m3-fast-dev-pill">DEVELOPMENT</span>
            <span className="m3-fast-dev-title">One-Click Superuser Access</span>
          </div>

          <div className="m3-fast-dev-grid">
            <button
              type="button"
              className="m3-fast-access-card admin"
              onClick={() => loginAsSuperuser('admin')}
              id="btn-login-superuser-admin"
            >
              <div className="m3-access-icon">👑</div>
              <div className="m3-access-info">
                <strong>Admin / Superuser</strong>
                <small>Jordan Rivera · Full Workspace & Audit</small>
              </div>
              <div className="m3-access-arrow">→</div>
            </button>

            <button
              type="button"
              className="m3-fast-access-card dev"
              onClick={() => loginAsSuperuser('developer')}
              id="btn-login-superuser-dev"
            >
              <div className="m3-access-icon">👤</div>
              <div className="m3-access-info">
                <strong>Successor Developer</strong>
                <small>Alex Vance · Onboarding & Checklist</small>
              </div>
              <div className="m3-access-arrow">→</div>
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="m3-auth-separator">
          <span>OR SIGN IN WITH ACCOUNT</span>
        </div>

        {/* Segmented Tab Switcher */}
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

        {/* Credentials Form */}
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

        <div className="m3-auth-footer">
          <span>Local Engine · No external telemetry</span>
        </div>
      </div>
    </div>
  );
}
