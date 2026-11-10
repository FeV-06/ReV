import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { validatePostgresUrl, testPostgresConnection, syncToSupabase } from '@/lib/server/sync-supabase';
import { createRun } from '@/lib/server/store';
import type { Run } from '@/lib/contracts';

describe('Supabase & PostgreSQL sync engine', () => {
  it('validates postgresql and postgres URL schemes accurately', () => {
    expect(validatePostgresUrl('postgresql://localhost:5432/db')).toBe(true);
    expect(validatePostgresUrl('postgres://aws-0-pooler.supabase.com:6543/postgres')).toBe(true);
    expect(validatePostgresUrl('mysql://localhost:3306/db')).toBe(false);
    expect(validatePostgresUrl('http://localhost:3000')).toBe(false);
    expect(validatePostgresUrl('invalid-string')).toBe(false);
  });

  it('handles empty or malformed connection strings safely in testPostgresConnection', async () => {
    const emptyResult = await testPostgresConnection('');
    expect(emptyResult.success).toBe(false);
    expect(emptyResult.error).toContain('empty');

    const invalidResult = await testPostgresConnection('invalid-url');
    expect(invalidResult.success).toBe(false);
    expect(invalidResult.error).toContain('Invalid URL');
  });

  it('fails gracefully without throwing when connecting to an unreachable host', async () => {
    // Unreachable loopback port with short timeout
    const result = await testPostgresConnection('postgresql://127.0.0.1:54329/nonexistent');
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('returns safe fallback when syncToSupabase has no connection configured', async () => {
    const origSupabase = process.env.SUPABASE_POSTGRES_URL;
    const origDb = process.env.DATABASE_URL;
    try {
      delete process.env.SUPABASE_POSTGRES_URL;
      delete process.env.DATABASE_URL;

      const result = await syncToSupabase('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
      expect(result.syncedRuns).toBe(0);
    } finally {
      if (origSupabase) process.env.SUPABASE_POSTGRES_URL = origSupabase;
      if (origDb) process.env.DATABASE_URL = origDb;
    }
  });

  it('gracefully handles unreachable database during sync without crashing', async () => {
    const run: Run = {
      id: randomUUID(),
      recipient: 'Fixture',
      createdAt: new Date().toISOString(),
      state: 'needs_review',
      artifacts: [],
      warnings: [],
      selectedIds: [],
      items: [],
      mode: 'fixture',
      revision: 1,
      approvedRevision: null,
      acceptedPartial: false,
    };
    await createRun(run);

    const result = await syncToSupabase('postgresql://127.0.0.1:54328/rev_test_offline');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.syncedRuns).toBe(0);
  });
});
