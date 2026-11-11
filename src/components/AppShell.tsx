'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import DemoSpotlightTour from '@/components/demo/DemoSpotlightTour';

export type ActiveTab = 'projects' | 'settings' | 'about';

interface AppShellProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  children: React.ReactNode;
}

export default function AppShell({ activeTab, onTabChange, children }: AppShellProps) {
  const { user, logout, evalMode, setEvalMode } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="m3-shell">
      {/* Top Application Bar */}
      <header className="m3-app-bar" role="banner">
        <div className="m3-app-bar-left">
          <div
            className="m3-brand-link"
            onClick={() => onTabChange('projects')}
            role="button"
            tabIndex={0}
          >
            <div className="m3-brand-icon" aria-hidden="true">R</div>
            <span className="m3-brand-title">ReV</span>
          </div>
        </div>

        {/* Center Primary Navigation Tabs */}
        {user ? (
          <nav className="m3-nav-rail" aria-label="Primary navigation">
            <button
              type="button"
              className={`m3-nav-pill ${activeTab === 'projects' ? 'active' : ''}`}
              onClick={() => { onTabChange('projects'); setMobileMenuOpen(false); }}
              aria-selected={activeTab === 'projects'}
              role="tab"
            >
              Projects
            </button>

            <button
              type="button"
              className={`m3-nav-pill ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => { onTabChange('settings'); setMobileMenuOpen(false); }}
              aria-selected={activeTab === 'settings'}
              role="tab"
            >
              Settings
            </button>

            <button
              type="button"
              className={`m3-nav-pill ${activeTab === 'about' ? 'active' : ''}`}
              onClick={() => { onTabChange('about'); setMobileMenuOpen(false); }}
              aria-selected={activeTab === 'about'}
              role="tab"
            >
              About
            </button>
          </nav>
        ) : (
          <nav className="m3-nav-rail" aria-label="Primary navigation">
            <button
              type="button"
              className={`m3-nav-pill ${activeTab === 'about' ? 'active' : ''}`}
              onClick={() => onTabChange('about')}
              aria-selected={activeTab === 'about'}
              role="tab"
            >
              About ReV
            </button>
          </nav>
        )}

        {/* Right Section: Evaluation Switcher & User Session */}
        <div className="m3-app-bar-right">
          {/* Mode Switcher */}
          <div className="m3-mode-selector" role="group" aria-label="Evaluation mode selector">
            <button
              type="button"
              className={`m3-mode-pill ${evalMode === 'demo' ? 'active-demo' : ''}`}
              onClick={() => setEvalMode('demo')}
              title="Switch to Instant Guided Demo (Zero-Latency Showcase)"
            >
              <span className="m3-mode-pill-ico">⚡</span>
              <span>Demo</span>
            </button>
            <button
              type="button"
              className={`m3-mode-pill ${evalMode === 'live' ? 'active-live' : ''}`}
              onClick={() => setEvalMode('live')}
              title="Switch to Live Engine (Real Public GitHub & AST Analysis)"
            >
              <span className="m3-mode-pill-ico">🔬</span>
              <span>Live</span>
            </button>
          </div>

          {user ? (
            <div className="m3-session-cluster">
              <div className="m3-session-user-badge">
                <span className="m3-session-avatar">{user.avatar}</span>
                <span className="m3-session-name">{user.name}</span>
                <span className="m3-session-role-tag">{user.role === 'admin' ? 'ADMIN' : user.role === 'departing' ? 'DEPARTING' : 'DEV'}</span>
              </div>

              <button
                type="button"
                className="m3-signout-action"
                onClick={logout}
                title="Sign out of current session"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="m3-signin-action"
              onClick={() => onTabChange('projects')}
            >
              Sign in
            </button>
          )}

          {/* Mobile hamburger */}
          <button
            type="button"
            className="m3-mobile-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
          >
            ☰
          </button>
        </div>
      </header>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="m3-mobile-drawer">
          {user ? (
            <>
              <div className="m3-mobile-nav-links">
                <button
                  type="button"
                  className={`m3-mobile-nav-item ${activeTab === 'projects' ? 'active' : ''}`}
                  onClick={() => { onTabChange('projects'); setMobileMenuOpen(false); }}
                >
                  📁 Projects
                </button>
                <button
                  type="button"
                  className={`m3-mobile-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
                  onClick={() => { onTabChange('settings'); setMobileMenuOpen(false); }}
                >
                  ⚙️ Settings
                </button>
                <button
                  type="button"
                  className={`m3-mobile-nav-item ${activeTab === 'about' ? 'active' : ''}`}
                  onClick={() => { onTabChange('about'); setMobileMenuOpen(false); }}
                >
                  ℹ️ About
                </button>
              </div>
              <div className="m3-mobile-session-footer">
                <span>Signed in as <b>{user.name}</b> ({user.role})</span>
                <button
                  type="button"
                  className="m3-signout-action"
                  onClick={() => { logout(); setMobileMenuOpen(false); }}
                  style={{ marginTop: '10px' }}
                >
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <div className="m3-mobile-nav-links">
              <button
                type="button"
                className={`m3-mobile-nav-item ${activeTab === 'about' ? 'active' : ''}`}
                onClick={() => { onTabChange('about'); setMobileMenuOpen(false); }}
              >
                ℹ️ About ReV
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Viewport Container */}
      <main className="m3-viewport">
        {children}
      </main>

      {/* Floating Demo Spotlight Tour */}
      <DemoSpotlightTour />

      {/* Footer */}
      <footer className="m3-footer">
        <div className="m3-footer-content">
          <span>ReV <span>·</span> Evidence-First Handover Verification Engine</span>
          <span className="m3-footer-tag">Material 3 Expressive · Local Engine</span>
        </div>
      </footer>
    </div>
  );
}
