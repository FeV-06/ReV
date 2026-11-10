import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSettings, saveSettings, getEffectiveCoreEnv } from '@/lib/server/settings';

describe('server settings persistence & rev-core env bridge', () => {
  let tempDir = '';
  const origDataDir = process.env.REV_DATA_DIR;

  afterEach(async () => {
    if (origDataDir !== undefined) process.env.REV_DATA_DIR = origDataDir;
    else delete process.env.REV_DATA_DIR;

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      tempDir = '';
    }
  });

  it('persists settings to disk and maps them into rev-core environment variables', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'rev-settings-test-'));
    process.env.REV_DATA_DIR = tempDir;

    const defaults = await loadSettings();
    expect(defaults.provider).toBe('openai');
    expect(defaults.dbMode).toBe('pglite');

    await saveSettings({
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key',
      modelName: 'claude-3-5-sonnet',
      baseUrl: 'https://api.anthropic.com/v1',
      githubToken: 'ghp_testtoken123',
      dbMode: 'supabase',
      postgresUri: 'postgresql://postgres:pw@db.supabase.co:5432/postgres',
    });

    const reloaded = await loadSettings();
    expect(reloaded.provider).toBe('anthropic');
    expect(reloaded.githubToken).toBe('ghp_testtoken123');
    expect(reloaded.postgresUri).toContain('supabase.co');

    const effectiveEnv = await getEffectiveCoreEnv();
    expect(effectiveEnv.REV_MODEL_PROVIDER).toBe('anthropic');
    expect(effectiveEnv.REV_MODEL_API_KEY).toBe('sk-ant-test-key');
    expect(effectiveEnv.REV_MODEL_NAME).toBe('claude-3-5-sonnet');
    expect(effectiveEnv.REV_MODEL_BASE_URL).toBe('https://api.anthropic.com/v1');
    expect(effectiveEnv.REV_GITHUB_TOKEN).toBe('ghp_testtoken123');
  });
});

