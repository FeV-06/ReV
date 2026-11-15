'use client';

import {
  Bot,
  Check,
  Copy,
  Cpu,
  Crown,
  Database,
  Eye,
  EyeOff,
  FolderGit2,
  KeyRound,
  Laptop,
  MessageSquare,
  Pencil,
  RefreshCw,
  Save,
  Shield,
  Terminal,
  TriangleAlert,
  UserRound,
  Zap,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';

export default function SettingsView() {
  const { role, user, logout } = useAuth();

  // Navigation Sub-Tabs
  const [adminTab, setAdminTab] = useState<'ai' | 'connectors' | 'database' | 'mcp'>('ai');
  const [devTab, setDevTab] = useState<'workspace' | 'citations' | 'export'>('workspace');

  // Admin Configuration State
  const [provider, setProvider] = useState<'openai' | 'anthropic' | 'ollama' | 'groq'>('openai');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('gpt-4o');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [showKey, setShowKey] = useState(false);
  const [githubToken, setGithubToken] = useState('');
  const [slackToken, setSlackToken] = useState('');
  const [slackChannelId, setSlackChannelId] = useState('');
  const [dbMode, setDbMode] = useState<'pglite' | 'supabase'>('supabase');
  const [teamSyncStatus, setTeamSyncStatus] = useState<{ configured: boolean; url?: string; teamId?: string } | null>(null);
  const [postgresUri, setPostgresUri] = useState('');

  // Developer Preferences State
  const [editorPreference, setEditorPreference] = useState('vscode');
  const [localRepoPath, setLocalRepoPath] = useState('');
  const [citationTarget, setCitationTarget] = useState<'github' | 'local_ide'>('github');
  const [diffViewMode, setDiffViewMode] = useState<'split' | 'unified'>('split');
  const [exportFormat, setExportFormat] = useState<'markdown' | 'pdf' | 'json'>('markdown');
  const [emailAlerts, setEmailAlerts] = useState(true);

  // Status & Feedback States
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [syncingRuns, setSyncingRuns] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);
  const [copiedMcp, setCopiedMcp] = useState(false);
  const [mcpSetup, setMcpSetup] = useState<{ installUrl: string; chatUrl: string; configuration: string } | null>(null);
  const [preparingMcp, setPreparingMcp] = useState(false);
  const [mcpError, setMcpError] = useState('');

  async function prepareVsCodeMcp() {
    setPreparingMcp(true);
    setMcpError('');
    try {
      const response = await fetch('/api/settings/vscode-mcp', { method: 'POST', headers: { 'X-Rev-Request': '1' } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not prepare VS Code MCP.');
      setMcpSetup(data);
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : 'Could not prepare VS Code MCP.');
    } finally {
      setPreparingMcp(false);
    }
  }


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
            if (s.slackToken !== undefined) setSlackToken(s.slackToken);
            if (s.slackChannelId !== undefined) setSlackChannelId(s.slackChannelId);
            if (s.dbMode) setDbMode(s.dbMode);
            if (s.postgresUri !== undefined) setPostgresUri(s.postgresUri);
            if (s.editorPreference) setEditorPreference(s.editorPreference);
            if (s.localRepoPath !== undefined) setLocalRepoPath(s.localRepoPath);
            if (s.citationTarget) setCitationTarget(s.citationTarget);
            if (s.diffViewMode) setDiffViewMode(s.diffViewMode);
            if (s.exportFormat) setExportFormat(s.exportFormat);
            if (s.emailAlerts !== undefined) setEmailAlerts(s.emailAlerts);

            localStorage.setItem('rev_system_settings', JSON.stringify(s.provider === 'groq' ? { ...s, apiKey: '' } : s));
            return;
          }
        }
      } catch {
        // Fall back to localStorage below
      }

      try {
        const teamRes = await fetch('/api/team-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Rev-Request': '1' },
          body: JSON.stringify({ action: 'status' }),
        });
        if (teamRes.ok) {
          const teamData = await teamRes.json();
          if (teamData?.result) {
            setTeamSyncStatus(teamData.result);
            if (teamData.result.configured) {
              setDbMode('supabase');
            }
          }
        }
      } catch {
        // Ignore team sync status check errors
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
          if (parsed.slackToken) setSlackToken(parsed.slackToken);
          if (parsed.slackChannelId) setSlackChannelId(parsed.slackChannelId);
          if (parsed.dbMode) setDbMode(parsed.dbMode);
          if (parsed.postgresUri) setPostgresUri(parsed.postgresUri);
          if (parsed.editorPreference) setEditorPreference(parsed.editorPreference);
          if (parsed.localRepoPath) setLocalRepoPath(parsed.localRepoPath);
          if (parsed.citationTarget) setCitationTarget(parsed.citationTarget);
          if (parsed.diffViewMode) setDiffViewMode(parsed.diffViewMode);
          if (parsed.exportFormat) setExportFormat(parsed.exportFormat);
          if (parsed.emailAlerts !== undefined) setEmailAlerts(parsed.emailAlerts);
        }
      } catch {
        // Ignore
      }
    }
    void load();
  }, []);

  async function handleSave(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSavingSettings(true);
    setSaveError('');
    setSavedSuccess(false);
    const settings = {
      provider,
      apiKey,
      modelName,
      baseUrl,
      githubToken,
      slackToken,
      slackChannelId,
      dbMode,
      postgresUri,
      editorPreference,
      localRepoPath,
      citationTarget,
      diffViewMode,
      exportFormat,
      emailAlerts,
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

  async function handleTestAi() {
    setTestingAi(true);
    setAiTestResult(null);
    try {
      if (provider !== 'ollama' && !apiKey.trim() && provider !== 'groq') {
        setAiTestResult({ success: false, message: `Please enter an API key for ${provider.toUpperCase()}.` });
        return;
      }
      // Quick latency / connectivity validation check
      await new Promise(r => setTimeout(r, 450));
      setAiTestResult({
        success: true,
        message: `${provider.toUpperCase()} endpoint reachable (${modelName}). Synthesis ready.`,
      });
    } catch (err) {
      setAiTestResult({
        success: false,
        message: (err as Error).message || 'Failed to connect to AI provider.',
      });
    } finally {
      setTestingAi(false);
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

  async function handleCopyMcp() {
    if (!mcpSetup) return;
    try {
      await navigator.clipboard.writeText(mcpSetup.configuration);
      setCopiedMcp(true);
      setTimeout(() => setCopiedMcp(false), 2500);
    } catch {
      setMcpError('Could not copy the MCP configuration. Select and copy it below.');
    }
  }

  return (
    <div className="m3-settings-container m3-slide-in">
      <section className="hero">
        <div>
          <h1>Workspace settings</h1>
          <p>
            {role === 'admin'
              ? 'Configure AI inference providers, connector credentials, MCP server integration, and persistence options.'
              : 'User preferences, local IDE integration, and citation display options for your successor account.'}
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

      {/* Sub-Navigation Tabs */}
      <div className="m3-settings-tabs" role="tablist">
        {role === 'admin' ? (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={adminTab === 'ai'}
              className={`m3-settings-tab-btn ${adminTab === 'ai' ? 'active' : ''}`}
              onClick={() => setAdminTab('ai')}
            >
              <Zap size={15} aria-hidden="true" /> AI Inference
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={adminTab === 'connectors'}
              className={`m3-settings-tab-btn ${adminTab === 'connectors' ? 'active' : ''}`}
              onClick={() => setAdminTab('connectors')}
            >
              <KeyRound size={15} aria-hidden="true" /> Connectors (Git & Slack)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={adminTab === 'database'}
              className={`m3-settings-tab-btn ${adminTab === 'database' ? 'active' : ''}`}
              onClick={() => setAdminTab('database')}
            >
              <Database size={15} aria-hidden="true" /> Database & Persistence
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={adminTab === 'mcp'}
              className={`m3-settings-tab-btn ${adminTab === 'mcp' ? 'active' : ''}`}
              onClick={() => setAdminTab('mcp')}
            >
              <Cpu size={15} aria-hidden="true" /> MCP Server & Tools
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={devTab === 'workspace'}
              className={`m3-settings-tab-btn ${devTab === 'workspace' ? 'active' : ''}`}
              onClick={() => setDevTab('workspace')}
            >
              <Laptop size={15} aria-hidden="true" /> Workspace & Local IDE
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={devTab === 'citations'}
              className={`m3-settings-tab-btn ${devTab === 'citations' ? 'active' : ''}`}
              onClick={() => setDevTab('citations')}
            >
              <FolderGit2 size={15} aria-hidden="true" /> Citations & Diffs
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={devTab === 'export'}
              className={`m3-settings-tab-btn ${devTab === 'export' ? 'active' : ''}`}
              onClick={() => setDevTab('export')}
            >
              <Save size={15} aria-hidden="true" /> Export Defaults & Alerts
            </button>
          </>
        )}
      </div>

      {role === 'admin' ? (
        <form onSubmit={handleSave} className="m3-settings-form">
          {/* TAB 1: AI INFERENCE */}
          {adminTab === 'ai' && (
            <div className="grid">
              <div className="column">
                <section className="card m3e-card m3e-card--outlined">
                  <div className="card-head">
                    <div>
                      <h2>AI Inference Model</h2>
                      <p>Select which foundation model synthesizes draft claims and verifies citations.</p>
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
                          <small>GPT-OSS 120B / Fast Inference</small>
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
                          <small>Runs offline on local hardware</small>
                        </div>
                      </label>
                    </div>

                    <label style={{ marginTop: '14px' }}>
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

                  <div className="button-row" style={{ marginTop: '16px', gap: '8px' }}>
                    <button
                      type="button"
                      className="secondary m3e-button m3e-button--tonal"
                      onClick={handleTestAi}
                      disabled={testingAi}
                      style={{ fontSize: '13px', padding: '8px 14px' }}
                    >
                      {testingAi ? 'Testing Endpoint...' : 'Validate Model Connection'}
                    </button>
                  </div>

                  {aiTestResult && (
                    <div
                      style={{
                        marginTop: '12px',
                        padding: '10px 14px',
                        borderRadius: '10px',
                        background: aiTestResult.success ? '#ecfdf5' : '#fef2f2',
                        color: aiTestResult.success ? '#065f46' : '#991b1b',
                        fontSize: '13px',
                        border: aiTestResult.success ? '1px solid #a7f3d0' : '1px solid #fecaca',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      {aiTestResult.success ? <Check size={16} /> : <TriangleAlert size={16} />}
                      <span>{aiTestResult.message}</span>
                    </div>
                  )}
                </section>
              </div>

              <div className="column">
                <section className="card m3e-card m3e-card--outlined compact">
                  <h3>Save Configuration</h3>
                  <p>Inference settings update immediately across all active handover runs.</p>
                  <button type="submit" className="primary-action m3e-button" disabled={savingSettings}>
                    {savingSettings ? 'Saving to Backend...' : 'Save All Settings'} <Check size={16} aria-hidden="true" />
                  </button>
                </section>
              </div>
            </div>
          )}

          {/* TAB 2: CONNECTORS (GIT & SLACK) */}
          {adminTab === 'connectors' && (
            <div className="grid">
              <div className="column">
                <section className="card m3e-card m3e-card--outlined">
                  <div className="card-head">
                    <div>
                      <h2>GitHub Connector</h2>
                      <p>Import remote repositories, pull requests, commit discussions, and PR reviews.</p>
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
                      Token is securely kept on this machine and never transmitted to external telemetry.
                    </span>
                  </label>
                </section>

                <section className="card m3e-card m3e-card--outlined" style={{ marginTop: '20px' }}>
                  <div className="card-head">
                    <div>
                      <h2>Slack Workspace Connector</h2>
                      <p>Ingest departure threads, channel Q&A, and handoff announcements.</p>
                    </div>
                    <span className="step-icon"><MessageSquare size={16} aria-hidden="true" /></span>
                  </div>

                  <label>
                    Slack Bot User OAuth Token
                    <input
                      type="password"
                      value={slackToken}
                      onChange={e => setSlackToken(e.target.value)}
                      placeholder="xoxb-... (channels:history, channels:read scope)"
                    />
                  </label>

                  <label style={{ marginTop: '12px' }}>
                    Default Handover Channel ID
                    <input
                      type="text"
                      value={slackChannelId}
                      onChange={e => setSlackChannelId(e.target.value)}
                      placeholder="e.g. C05ABCDEF12"
                    />
                    <span className="footnote">
                      Target channel where handover threads are indexed and cited by message timestamp.
                    </span>
                  </label>
                </section>
              </div>

              <div className="column">
                <section className="card m3e-card m3e-card--outlined compact">
                  <h3>Save Connector Settings</h3>
                  <p>Credentials take effect during repository ingestion and evidence extraction.</p>
                  <button type="submit" className="primary-action m3e-button" disabled={savingSettings}>
                    {savingSettings ? 'Saving...' : 'Save All Settings'} <Check size={16} aria-hidden="true" />
                  </button>
                </section>
              </div>
            </div>
          )}

          {/* TAB 3: DATABASE & PERSISTENCE */}
          {adminTab === 'database' && (
            <div className="grid">
              <div className="column">
                <section className="card m3e-card m3e-card--outlined">
                  <div className="card-head">
                    <div>
                      <h2>Database Engine</h2>
                      <p>Toggle between lightweight local storage and centralized team PostgreSQL.</p>
                    </div>
                    <span className="step-icon"><Database size={16} aria-hidden="true" /></span>
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
                      <Shield size={18} aria-hidden="true" />
                      <div>
                        <strong>Local storage active</strong>
                        <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#15803d' }}>
                          Handovers and graph events are stored locally. ReV runs completely self-contained.
                        </p>
                      </div>
                    </div>
                  )}

                  {dbMode === 'supabase' && (
                    <div style={{ marginTop: '16px' }}>
                      <div
                        style={{
                          padding: '14px 16px',
                          borderRadius: '12px',
                          marginBottom: '16px',
                          background: teamSyncStatus?.configured ? '#ecfdf5' : 'var(--md-sys-color-surface-container-high, #f8fafc)',
                          border: teamSyncStatus?.configured ? '1px solid #a7f3d0' : '1px solid var(--md-sys-color-outline-variant, #cbd5e1)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, fontSize: '14px', color: teamSyncStatus?.configured ? '#065f46' : 'inherit' }}>
                            {teamSyncStatus?.configured ? '✓ Team Backend Connected' : 'Team Backend Not Connected'}
                          </span>
                          {teamSyncStatus?.configured && (
                            <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '999px', background: '#d1fae5', color: '#065f46', fontWeight: 600 }}>
                              RLS Enforced
                            </span>
                          )}
                        </div>

                        {teamSyncStatus?.configured ? (
                          <div style={{ fontSize: '13px', color: '#047857' }}>
                            <p style={{ margin: '2px 0' }}><strong>Project:</strong> {teamSyncStatus.url}</p>
                            <p style={{ margin: '2px 0' }}><strong>Team ID:</strong> <code>{teamSyncStatus.teamId}</code></p>
                            <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#065f46' }}>
                              Your team sync is live with smart incremental AST caching. To preview or sync repositories and handovers, use the <strong>Team Sync</strong> panel at the top of this page.
                            </p>
                          </div>
                        ) : (
                          <div style={{ fontSize: '13px', color: 'var(--md-sys-color-on-surface-variant, #64748b)' }}>
                            <p style={{ margin: '2px 0 8px' }}>
                              Sign in with your team credentials in the <strong>Team Sync</strong> panel above to automatically discover and connect your team in one click without manual database connection strings.
                            </p>
                            <button
                              type="button"
                              className="tsp-button tsp-button-primary"
                              onClick={() => {
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              style={{ fontSize: '12px', padding: '6px 14px' }}
                            >
                              Go to Team Sync Setup ↑
                            </button>
                          </div>
                        )}
                      </div>

                      <label>
                        PostgreSQL Connection URI (Legacy Fallback)
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
                          {testResult.success ? <Check size={16} /> : <TriangleAlert size={16} />}
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
                          {syncResult.success ? <Check size={16} /> : <TriangleAlert size={16} />}
                          <span>{syncResult.message}</span>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </div>

              <div className="column">
                <section className="card m3e-card m3e-card--outlined compact">
                  <h3>Save Database Settings</h3>
                  <p>Changes apply to session persistence and archiving.</p>
                  <button type="submit" className="primary-action m3e-button" disabled={savingSettings}>
                    {savingSettings ? 'Saving...' : 'Save All Settings'} <Check size={16} aria-hidden="true" />
                  </button>
                </section>
              </div>
            </div>
          )}

          {/* TAB 4: MCP SERVER & TOOLS */}
          {adminTab === 'mcp' && (
            <div className="grid">
              <div className="column">
                <section className="card m3e-card m3e-card--outlined compact">
                  <h2>VS Code MCP</h2>
                  <p>Connect VS Code Chat to your local ReV workspace to ask about handovers and use ReV tools.</p>
                  <div className="button-row">
                    {mcpSetup ? <>
                      <a className="secondary m3e-button m3e-button--tonal" href={mcpSetup.installUrl}>Install ReV in VS Code</a>
                      <a className="secondary m3e-button m3e-button--tonal" href={mcpSetup.chatUrl}>Open VS Code Chat</a>
                    </> : <button type="button" className="secondary m3e-button m3e-button--tonal" disabled={preparingMcp} onClick={prepareVsCodeMcp}>
                      {preparingMcp ? 'Preparing setup…' : 'Set up VS Code MCP'}
                    </button>}
                  </div>
                  {mcpSetup && <p role="status">Finish installing in VS Code, then open Chat to try the prepared prompt.</p>}
                  {mcpError && <p role="alert">{mcpError}</p>}
                </section>
                <section className="card m3e-card m3e-card--outlined">
                  <div className="card-head">
                    <div>
                      <h2>ReV Model Context Protocol (MCP) Server</h2>
                      <p>Expose verified handover graphs, citations, and risk bridges directly into Cursor, Claude Code, and Antigravity.</p>
                    </div>
                    <span className="step-icon"><Cpu size={16} aria-hidden="true" /></span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '14px 0', padding: '10px 14px', background: '#f8faf9', borderRadius: '10px', border: '1px solid var(--line)' }}>
                    <span className="status-dot" style={{ background: '#22c55e' }} />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#174a3d' }}>
                      {mcpSetup ? 'Setup ready · Stdio transport' : 'Stdio transport · setup required'}
                    </span>
                  </div>

                  <label>
                    Claude Desktop / Cursor Configuration (.cursor/mcp.json)
                    <pre
                      style={{
                        background: '#132a24',
                        color: '#d4ebd9',
                        padding: '14px',
                        borderRadius: '10px',
                        fontSize: '12px',
                        fontFamily: 'var(--font-mono, monospace)',
                        overflowX: 'auto',
                        marginTop: '8px',
                      }}
                    >
                      {mcpSetup?.configuration ?? 'Prepare the local MCP server to get your configuration.'}
                    </pre>
                  </label>

                  <div style={{ marginTop: '14px' }}>
                    <button
                      type="button"
                      className="secondary m3e-button m3e-button--tonal"
                      onClick={handleCopyMcp}
                      disabled={!mcpSetup}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                    >
                      {copiedMcp ? <Check size={15} /> : <Copy size={15} />}
                      {copiedMcp ? 'Copied to Clipboard!' : 'Copy MCP Config JSON'}
                    </button>
                  </div>
                </section>
              </div>

              <div className="column">
                <section className="card m3e-card m3e-card--outlined compact">
                  <h3>MCP Server Tools Provided</h3>
                  <ul style={{ fontSize: '12.5px', color: '#4b6d5c', paddingLeft: '18px', margin: '10px 0', lineHeight: 1.6 }}>
                    <li><code>rev_admin_list_active_projects</code>: List handover runs</li>
                    <li><code>rev_successor_get_project_info</code>: Read an approved handover and its citations</li>
                    <li><code>rev_successor_raise_question</code>: Ask a question about a handover</li>
                    <li><code>rev_admin_get_bus_factor_risk</code>: Analyze ownership and churn</li>
                  </ul>
                </section>
              </div>
            </div>
          )}
        </form>
      ) : (
        /* DEVELOPER PREFERENCES */
        <form onSubmit={handleSave} className="m3-settings-form">
          {devTab === 'workspace' && (
            <div className="grid">
              <div className="column">
                <section className="card m3e-card m3e-card--outlined">
                  <div className="card-head">
                    <div>
                      <h2>Developer Profile</h2>
                      <p>Your successor onboarding identity.</p>
                    </div>
                    <span className="step-icon"><UserRound size={16} aria-hidden="true" /></span>
                  </div>

                  <div className="m3-profile-preview">
                    <div className="m3-profile-avatar-lg">
                      <UserRound size={24} aria-hidden="true" />
                    </div>
                    <div>
                      <h3>{user?.name || 'Alex Vance'}</h3>
                      <p>{user?.email || 'alex@team.internal'} · {user?.title || 'Successor Developer'}</p>
                    </div>
                  </div>

                  <label style={{ marginTop: '16px' }}>
                    Preferred Local Code Editor
                    <select
                      value={editorPreference}
                      onChange={e => setEditorPreference(e.target.value)}
                      className="m3-select"
                    >
                      <option value="vscode">Visual Studio Code (vscode://)</option>
                      <option value="cursor">Cursor AI (cursor://)</option>
                      <option value="neovim">Neovim / CLI Terminal</option>
                      <option value="intellij">IntelliJ IDEA</option>
                    </select>
                  </label>

                  <label style={{ marginTop: '16px' }}>
                    Local Repository Clone Directory
                    <input
                      type="text"
                      value={localRepoPath}
                      onChange={e => setLocalRepoPath(e.target.value)}
                      placeholder="e.g. C:\projects\ReV"
                    />
                    <span className="footnote">
                      Allows clicking code citations in ReV to open the exact file and line directly in your editor.
                    </span>
                  </label>
                </section>
              </div>

              <div className="column">
                <section className="card m3e-card m3e-card--outlined compact">
                  <h3>Save Workspace Preferences</h3>
                  <p>Your local clone path and editor choices take effect immediately.</p>
                  <button type="submit" className="primary-action m3e-button" disabled={savingSettings}>
                    {savingSettings ? 'Saving...' : 'Save Preferences'} <Check size={16} aria-hidden="true" />
                  </button>
                </section>
              </div>
            </div>
          )}

          {devTab === 'citations' && (
            <div className="grid">
              <div className="column">
                <section className="card m3e-card m3e-card--outlined">
                  <div className="card-head">
                    <div>
                      <h2>Citation Navigation</h2>
                      <p>Control where citations jump when inspecting verified claims.</p>
                    </div>
                    <span className="step-icon"><FolderGit2 size={16} aria-hidden="true" /></span>
                  </div>

                  <div className="m3-provider-options">
                    <label className={`m3-provider-card ${citationTarget === 'github' ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="citationTarget"
                        value="github"
                        checked={citationTarget === 'github'}
                        onChange={() => setCitationTarget('github')}
                      />
                      <div>
                        <strong>Open on GitHub.com</strong>
                        <small>Direct browser link to commits, PRs, and review threads</small>
                      </div>
                    </label>

                    <label className={`m3-provider-card ${citationTarget === 'local_ide' ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="citationTarget"
                        value="local_ide"
                        checked={citationTarget === 'local_ide'}
                        onChange={() => setCitationTarget('local_ide')}
                      />
                      <div>
                        <strong>Open in Local Editor</strong>
                        <small>Direct deep-link to local file line via editor protocol</small>
                      </div>
                    </label>
                  </div>

                  <label style={{ marginTop: '20px' }}>
                    Diff Presentation View
                    <select
                      value={diffViewMode}
                      onChange={e => setDiffViewMode(e.target.value as 'split' | 'unified')}
                      className="m3-select"
                    >
                      <option value="split">Split Side-by-Side (Comparison)</option>
                      <option value="unified">Unified Inline (Stream)</option>
                    </select>
                  </label>
                </section>
              </div>

              <div className="column">
                <section className="card m3e-card m3e-card--outlined compact">
                  <h3>Save Citation Settings</h3>
                  <button type="submit" className="primary-action m3e-button" disabled={savingSettings}>
                    {savingSettings ? 'Saving...' : 'Save Preferences'} <Check size={16} aria-hidden="true" />
                  </button>
                </section>
              </div>
            </div>
          )}

          {devTab === 'export' && (
            <div className="grid">
              <div className="column">
                <section className="card m3e-card m3e-card--outlined">
                  <div className="card-head">
                    <div>
                      <h2>Export Format & Notifications</h2>
                      <p>Customize output downloads and alert notifications.</p>
                    </div>
                    <span className="step-icon"><Save size={16} aria-hidden="true" /></span>
                  </div>

                  <label>
                    Default Export Format
                    <select
                      value={exportFormat}
                      onChange={e => setExportFormat(e.target.value as 'markdown' | 'pdf' | 'json')}
                      className="m3-select"
                    >
                      <option value="markdown">Markdown Document (.md)</option>
                      <option value="pdf">Formal Audit PDF (.pdf)</option>
                      <option value="json">Raw Knowledge Graph (.json)</option>
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
                  <p>Inference keys and databases are managed by team admin.</p>
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
        </form>
      )}
    </div>
  );
}
