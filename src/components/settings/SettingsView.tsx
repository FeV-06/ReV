'use client';

import { Check, Crown, KeyRound, Pencil, Save, Shield, TriangleAlert, UserRound, Zap } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';

export default function SettingsView() {
  const { role, user, logout } = useAuth();

  // Admin Configuration State
  const [provider, setProvider] = useState<'openai' | 'anthropic' | 'ollama' | 'groq'>('openai');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('gpt-4o');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [showKey, setShowKey] = useState(false);
  const [githubToken, setGithubToken] = useState('');
  const [dbMode, setDbMode] = useState<'pglite' | 'supabase'>('pglite');
  const [postgresUri, setPostgresUri] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [syncingRuns, setSyncingRuns] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);

  // Developer Preferences State
  const [editorPreference, setEditorPreference] = useState('vscode');
  const [emailAlerts, setEmailAlerts] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/settings', {
          headers: { 'X-Rev-Request': '1' },
        });
        if (res.ok) {
          const data = await res.json();
          const s = data.settings;
          if (s) {
            if (s.provider) setProvider(s.provider);
            if (s.apiKey !== undefined) setApiKey(s.apiKey);
            if (s.modelName) setModelName(s.modelName);
            if (s.baseUrl) setBaseUrl(s.baseUrl);
            if (s.githubToken !== undefined) setGithubToken(s.githubToken);
            if (s.dbMode) setDbMode(s.dbMode);
            if (s.postgresUri !== undefined) setPostgresUri(s.postgresUri);
            localStorage.setItem('rev_system_settings', JSON.stringify(s.provider === 'groq' ? { ...s, apiKey: '' } : s));
            return;
          }
        }
      } catch {
        // Fall back to localStorage below
      }

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
    }
    void load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    setSaveError('');
    setSavedSuccess(false);
    const settings = {
      provider,
      apiKey,
      modelName,
      baseUrl,
      githubToken,
      dbMode,
      postgresUri,
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Rev-Request': '1',
        },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to persist settings to backend');
      }
      localStorage.setItem('rev_system_settings', JSON.stringify(provider === 'groq' ? { ...settings, apiKey: '' } : settings));
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Error saving settings');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleTestConnection() {
    if (!postgresUri.trim()) return;
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/sync/supabase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Rev-Request': '1',
        },
        body: JSON.stringify({
          testOnly: true,
          connectionString: postgresUri.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({
          success: true,
          message: `Connected successfully! PostgreSQL ${data.version || 'Supabase ready'}`.trim(),
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || 'Connection failed. ReV will remain safe in local PGlite mode.',
        });
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: (err as Error).message || 'Network error during connection test',
      });
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleManualSync() {
    if (!window.confirm('Upload all local runs, including their source material and unapproved drafts, to the configured database? This action may send private data.')) return;
    setSyncingRuns(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/sync/supabase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Rev-Request': '1',
        },
        body: JSON.stringify({
          connectionString: postgresUri.trim() || undefined,
          // Bulk upload of every local run happens only on this explicit,
          // user-initiated action; no standing permission is stored.
          confirmSync: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSyncResult({
          success: true,
          message: `Successfully synced ${data.syncedRuns ?? 0} runs to remote Supabase instance.`,
        });
      } else {
        setSyncResult({
          success: false,
          message: data.error || 'Sync failed. Local data remains intact in PGlite.',
        });
      }
    } catch (err) {
      setSyncResult({
        success: false,
        message: (err as Error).message || 'Sync error occurred',
      });
    } finally {
      setSyncingRuns(false);
    }
  }

  return (
    <div className="m3-settings-container m3-slide-in">
      <section className="hero">
        <div>
          <h1>Workspace settings</h1>
          <p>
            {role === 'admin'
              ? 'Configure AI inference providers, connector credentials, and database persistence options.'
              : 'User preferences and workspace profile settings for your successor account.'}
          </p>
        </div>
        <div className="m3-role-tag">
          {role === 'admin' ? 'Admin workspace' : 'Successor workspace'}
        </div>
      </section>

      {savedSuccess && (
        <div role="status" className="notice" style={{ marginBottom: '24px' }}>
          <Check size={16} aria-hidden="true" /> Configuration settings saved and synchronized with local backend.
        </div>
      )}
      {saveError && (
        <div role="alert" className="error" style={{ marginBottom: '24px' }}>
          <TriangleAlert size={16} aria-hidden="true" /> {saveError}
        </div>
      )}

      {role === 'admin' ? (
        <form onSubmit={handleSave} className="m3-settings-form">
          <div className="grid">
            <div className="column">
              {/* AI MODEL PROVIDER */}
              <section className="card m3e-card m3e-card--outlined">
                <div className="card-head">
                  <div>
                    <h2>AI Model Provider</h2>
                    <p>Select which model synthesizes the draft claims from verified evidence.</p>
                  </div>
                  <span className="step-icon"><Zap size={16} aria-hidden="true" /></span>
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

                  <label className={`m3-provider-card ${provider === 'groq' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="provider"
                      value="groq"
                      checked={provider === 'groq'}
                      onChange={() => {
                        setProvider('groq');
                        setApiKey('');
                        setModelName('openai/gpt-oss-120b');
                        setBaseUrl('https://api.groq.com/openai/v1');
                      }}
                    />
                    <div>
                      <strong>Groq</strong>
                      <small>GPT-OSS 120B</small>
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
                      <small>Runs locally</small>
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
                      placeholder={provider === 'ollama' ? 'Optional for local Ollama' : provider === 'groq' ? 'gsk_…' : 'sk-…'}
                    />
                    <button
                      type="button"
                      className="secondary m3-inline-btn m3e-button m3e-button--tonal"
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
                      readOnly={provider === 'groq'}
                      onChange={e => setBaseUrl(e.target.value)}
                      placeholder="e.g. https://api.openai.com/v1"
                    />
                  </label>
                </div>
              </section>

              {/* REPOSITORY & CONNECTOR CREDENTIALS */}
              <section className="card m3e-card m3e-card--outlined">
                <div className="card-head">
                  <div>
                    <h2>Connector Credentials</h2>
                    <p>Authenticate GitHub and Slack for remote evidence collection.</p>
                  </div>
                  <span className="step-icon"><KeyRound size={16} aria-hidden="true" /></span>
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
              <section className="card m3e-card m3e-card--outlined">
                <div className="card-head">
                  <div>
                    <h2>Database Engine</h2>
                    <p>Toggle between lightweight local storage and centralized team PostgreSQL.</p>
                  </div>
                  <span className="step-icon"><Save size={16} aria-hidden="true" /></span>
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

                {dbMode === 'pglite' && (
                  <div
                    style={{
                      marginTop: '14px',
                      padding: '12px 14px',
                      borderRadius: '12px',
                      background: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      fontSize: '13px',
                      color: '#166534',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    <span style={{ fontSize: '18px' }}><Shield size={16} aria-hidden="true" /></span>
                    <div>
                      <strong>Local storage</strong>
                      <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#15803d' }}>
                        Handovers and graph events are stored locally. A manual cloud sync or configured external model can send data when requested.
                      </p>
                    </div>
                  </div>
                )}

                {dbMode === 'supabase' && (
                  <div style={{ marginTop: '16px' }}>
                    <label>
                      Supabase / PostgreSQL Connection URI
                      <input
                        type="password"
                        value={postgresUri}
                        onChange={e => {
                          setPostgresUri(e.target.value);
                          setTestResult(null);
                        }}
                        placeholder="postgres://postgres.xxx:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres"
                      />
                      <span className="footnote">
                        Connection pooling URI from Supabase Dashboard &gt; Project Settings &gt; Database.
                      </span>
                    </label>

                    <div className="button-row" style={{ marginTop: '12px', gap: '8px' }}>
                      <button
                        type="button"
                        className="secondary m3e-button m3e-button--tonal"
                        onClick={handleTestConnection}
                        disabled={testingConnection || !postgresUri.trim()}
                        style={{ fontSize: '13px', padding: '8px 14px' }}
                      >
                        {testingConnection ? 'Testing Connection...' : 'Test Connection'}
                      </button>

                      <button
                        type="button"
                        className="secondary m3e-button m3e-button--tonal"
                        onClick={handleManualSync}
                        disabled={syncingRuns || !postgresUri.trim()}
                        style={{ fontSize: '13px', padding: '8px 14px' }}
                      >
                        {syncingRuns ? 'Syncing...' : 'Sync Local Runs to Supabase'}
                      </button>
                    </div>

                    {testResult && (
                      <div
                        style={{
                          marginTop: '12px',
                          padding: '10px 14px',
                          borderRadius: '10px',
                          background: testResult.success ? '#ecfdf5' : '#fef2f2',
                          color: testResult.success ? '#065f46' : '#991b1b',
                          fontSize: '13px',
                          border: testResult.success ? '1px solid #a7f3d0' : '1px solid #fecaca',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <span>{testResult.success ? <Check size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}</span>
                        <span>{testResult.message}</span>
                      </div>
                    )}

                    {syncResult && (
                      <div
                        style={{
                          marginTop: '10px',
                          padding: '10px 14px',
                          borderRadius: '10px',
                          background: syncResult.success ? '#ecfdf5' : '#fef2f2',
                          color: syncResult.success ? '#065f46' : '#991b1b',
                          fontSize: '13px',
                          border: syncResult.success ? '1px solid #a7f3d0' : '1px solid #fecaca',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <span>{syncResult.success ? <Check size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}</span>
                        <span>{syncResult.message}</span>
                      </div>
                    )}

                    <p className="footnote" style={{ marginTop: '12px', color: '#6b7280' }}>
                      <strong>Safe Fallback:</strong> If remote Supabase is unreachable or unconfigured, ReV continues operating seamlessly in local PGlite with zero interruption.
                    </p>
                  </div>
                )}
              </section>

              {/* SAVE BUTTON CARD */}
              <section className="card m3e-card m3e-card--outlined compact">
                <h3>Save Configuration</h3>
                <p>Changes take effect immediately across all handover sessions.</p>
                <button type="submit" className="primary-action m3e-button" disabled={savingSettings}>
                  {savingSettings ? 'Saving to Backend...' : 'Save All Settings'} <span><Check size={16} aria-hidden="true" /></span>
                </button>
              </section>
            </div>
          </div>
        </form>
      ) : (
        /* DEVELOPER PLACEHOLDER SETTINGS */
        <div className="grid">
          <div className="column">
            <section className="card m3e-card m3e-card--outlined">
              <div className="card-head">
                <div>
                  <h2>Onboarding Profile</h2>
                  <p>Customise your developer workspace view and notifications.</p>
                </div>
                <span className="step-icon"><UserRound size={16} aria-hidden="true" /></span>
              </div>

              <div className="m3-profile-preview">
                <div className="m3-profile-avatar-lg">{user?.role === 'admin' ? <Crown size={24} aria-hidden="true" /> : user?.role === 'departing' ? <Pencil size={24} aria-hidden="true" /> : <UserRound size={24} aria-hidden="true" />}</div>
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
            <section className="card m3e-card m3e-card--outlined compact trust">
              <h3>Administrative Controls</h3>
              <p>
                Inference providers, GitHub tokens, and database connections are managed by your team administrator (Jordan Rivera).
              </p>
              <button
                type="button"
                className="secondary m3e-button m3e-button--tonal"
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

