'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';

export default function SettingsView() {
  const { role, user, logout } = useAuth();

  // Admin Configuration State
  const [provider, setProvider] = useState<'openai' | 'anthropic' | 'ollama'>('openai');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('gpt-4o');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [showKey, setShowKey] = useState(false);
  const [githubToken, setGithubToken] = useState('');
  const [dbMode, setDbMode] = useState<'pglite' | 'supabase'>('pglite');
  const [postgresUri, setPostgresUri] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Developer Preferences State
  const [editorPreference, setEditorPreference] = useState('vscode');
  const [emailAlerts, setEmailAlerts] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('rev_system_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.provider) setProvider(parsed.provider);
        if (parsed.apiKey) setApiKey(parsed.apiKey);
        if (parsed.modelName) setModelName(parsed.modelName);
        if (parsed.baseUrl) setBaseUrl(parsed.baseUrl);
        if (parsed.githubToken) setGithubToken(parsed.githubToken);
        if (parsed.dbMode) setDbMode(parsed.dbMode);
        if (parsed.postgresUri) setPostgresUri(parsed.postgresUri);
      }
    } catch {
      // Ignore
    }
  }, []);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      const settings = {
        provider,
        apiKey,
        modelName,
        baseUrl,
        githubToken,
        dbMode,
        postgresUri,
      };
      localStorage.setItem('rev_system_settings', JSON.stringify(settings));
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3500);
    } catch {
      // Ignore
    }
  }

  return (
    <div className="m3-settings-container m3-slide-in">
      <section className="hero">
        <div>
          <div className="eyebrow">CONFIGURATION & INTEGRATIONS</div>
          <h1>
            Workspace <em>Settings.</em>
          </h1>
          <p>
            {role === 'admin'
              ? 'Configure AI inference providers, connector credentials, and database persistence options.'
              : 'User preferences and workspace profile settings for your successor account.'}
          </p>
        </div>
        <div className="m3-role-tag">
          CURRENT VIEW: <strong>{role === 'admin' ? 'ADMIN / LEAD' : 'DEVELOPER'}</strong>
        </div>
      </section>

      {savedSuccess && (
        <div role="status" className="notice" style={{ marginBottom: '24px' }}>
          ✓ Configuration settings saved successfully.
        </div>
      )}

      {role === 'admin' ? (
        <form onSubmit={handleSave} className="m3-settings-form">
          <div className="grid">
            <div className="column">
              {/* AI MODEL PROVIDER */}
              <section className="card">
                <div className="card-head">
                  <div>
                    <div className="eyebrow">01 / INFERENCE ENGINE</div>
                    <h2>AI Model Provider</h2>
                    <p>Select which model synthesizes the draft claims from verified evidence.</p>
                  </div>
                  <span className="step-icon">⚡</span>
                </div>

                <div className="m3-provider-options">
                  <label className={`m3-provider-card ${provider === 'openai' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="provider"
                      value="openai"
                      checked={provider === 'openai'}
                      onChange={() => {
                        setProvider('openai');
                        setModelName('gpt-4o');
                        setBaseUrl('https://api.openai.com/v1');
                      }}
                    />
                    <div>
                      <strong>OpenAI</strong>
                      <small>GPT-4o, GPT-4o-mini</small>
                    </div>
                  </label>

                  <label className={`m3-provider-card ${provider === 'anthropic' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="provider"
                      value="anthropic"
                      checked={provider === 'anthropic'}
                      onChange={() => {
                        setProvider('anthropic');
                        setModelName('claude-3-5-sonnet-20241022');
                        setBaseUrl('https://api.anthropic.com/v1');
                      }}
                    />
                    <div>
                      <strong>Anthropic</strong>
                      <small>Claude 3.5 Sonnet</small>
                    </div>
                  </label>

                  <label className={`m3-provider-card ${provider === 'ollama' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="provider"
                      value="ollama"
                      checked={provider === 'ollama'}
                      onChange={() => {
                        setProvider('ollama');
                        setModelName('llama3.1:70b');
                        setBaseUrl('http://127.0.0.1:11434/v1');
                      }}
                    />
                    <div>
                      <strong>Local (Ollama / vLLM)</strong>
                      <small>Zero egress / air-gapped</small>
                    </div>
                  </label>
                </div>

                <label>
                  API Key / Secret Token
                  <div className="m3-input-with-button">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder={provider === 'ollama' ? 'Optional for local Ollama' : 'sk-...'}
                    />
                    <button
                      type="button"
                      className="secondary m3-inline-btn"
                      onClick={() => setShowKey(!showKey)}
                    >
                      {showKey ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </label>

                <div className="m3-two-col-inputs">
                  <label>
                    Model Identifier
                    <input
                      value={modelName}
                      onChange={e => setModelName(e.target.value)}
                      placeholder="e.g. gpt-4o"
                    />
                  </label>
                  <label>
                    Base API URL
                    <input
                      value={baseUrl}
                      onChange={e => setBaseUrl(e.target.value)}
                      placeholder="e.g. https://api.openai.com/v1"
                    />
                  </label>
                </div>
              </section>

              {/* REPOSITORY & CONNECTOR CREDENTIALS */}
              <section className="card">
                <div className="card-head">
                  <div>
                    <div className="eyebrow">02 / CONNECTORS</div>
                    <h2>Connector Credentials</h2>
                    <p>Authenticate GitHub and Slack for remote evidence collection.</p>
                  </div>
                  <span className="step-icon">🔑</span>
                </div>

                <label>
                  GitHub Personal Access Token (PAT)
                  <input
                    type="password"
                    value={githubToken}
                    onChange={e => setGithubToken(e.target.value)}
                    placeholder="ghp_... (repo and read:org scope)"
                  />
                  <span className="footnote">
                    Enables importing remote pull requests, commit discussions, and code reviews.
                  </span>
                </label>
              </section>
            </div>

            <div className="column">
              {/* DATABASE & STORAGE ENGINE */}
              <section className="card">
                <div className="card-head">
                  <div>
                    <div className="eyebrow">03 / STORAGE</div>
                    <h2>Database Engine</h2>
                    <p>Toggle between lightweight local storage and centralized team PostgreSQL.</p>
                  </div>
                  <span className="step-icon">💾</span>
                </div>

                <div className="m3-storage-picker">
                  <label className={`m3-storage-option ${dbMode === 'pglite' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="dbMode"
                      value="pglite"
                      checked={dbMode === 'pglite'}
                      onChange={() => setDbMode('pglite')}
                    />
                    <div>
                      <strong>Embedded PGlite (Default)</strong>
                      <p>WASM Postgres running locally in single-operator mode. Zero external infrastructure.</p>
                    </div>
                  </label>

                  <label className={`m3-storage-option ${dbMode === 'supabase' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="dbMode"
                      value="supabase"
                      checked={dbMode === 'supabase'}
                      onChange={() => setDbMode('supabase')}
                    />
                    <div>
                      <strong>Remote Supabase / PostgreSQL</strong>
                      <p>Connect to an external PostgreSQL database for persistent enterprise archiving.</p>
                    </div>
                  </label>
                </div>

                {dbMode === 'supabase' && (
                  <label style={{ marginTop: '16px' }}>
                    PostgreSQL Connection URI
                    <input
                      type="password"
                      value={postgresUri}
                      onChange={e => setPostgresUri(e.target.value)}
                      placeholder="postgres://user:password@db.supabase.co:5432/postgres"
                    />
                  </label>
                )}
              </section>

              {/* SAVE BUTTON CARD */}
              <section className="card compact">
                <div className="eyebrow">APPLY CHANGES</div>
                <h3>Save Configuration</h3>
                <p>Changes take effect immediately across all handover sessions.</p>
                <button type="submit" className="primary-action">
                  Save All Settings <span>✓</span>
                </button>
              </section>
            </div>
          </div>
        </form>
      ) : (
        /* DEVELOPER PLACEHOLDER SETTINGS */
        <div className="grid">
          <div className="column">
            <section className="card">
              <div className="card-head">
                <div>
                  <div className="eyebrow">SUCCESSOR PREFERENCES</div>
                  <h2>Onboarding Profile</h2>
                  <p>Customise your developer workspace view and notifications.</p>
                </div>
                <span className="step-icon">👤</span>
              </div>

              <div className="m3-profile-preview">
                <div className="m3-profile-avatar-lg">{user?.avatar || '👤'}</div>
                <div>
                  <h3>{user?.name || 'Alex Vance'}</h3>
                  <p>{user?.email || 'alex@team.internal'} · {user?.title || 'Successor Developer'}</p>
                </div>
              </div>

              <label>
                Preferred Code Editor
                <select
                  value={editorPreference}
                  onChange={e => setEditorPreference(e.target.value)}
                  className="m3-select"
                >
                  <option value="vscode">Visual Studio Code</option>
                  <option value="cursor">Cursor AI</option>
                  <option value="neovim">Neovim / CLI</option>
                  <option value="intellij">IntelliJ IDEA</option>
                </select>
              </label>

              <label className="check" style={{ marginTop: '16px' }}>
                <input
                  type="checkbox"
                  checked={emailAlerts}
                  onChange={e => setEmailAlerts(e.target.checked)}
                />{' '}
                Receive email summary when a new handover is approved and assigned
              </label>
            </section>
          </div>

          <div className="column">
            <section className="card compact trust">
              <div className="eyebrow">ACCESS NOTICE</div>
              <h3>Administrative Controls</h3>
              <p>
                Inference providers, GitHub tokens, and database connections are managed by your team administrator (Jordan Rivera).
              </p>
              <button
                type="button"
                className="secondary"
                onClick={logout}
              >
                Sign Out & Switch Account
              </button>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

