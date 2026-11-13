import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { importSlackChannels } from '../src/lib/server/sources';

describe('Slack Thread Expansion & Ingestion (Phase 2)', () => {
  beforeEach(() => {
    vi.stubEnv('REV_SLACK_BOT_TOKEN', 'xoxb-mock-token');
    vi.stubEnv('REV_SLACK_CHANNEL_IDS', 'C01234567');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('ingests top-level message and expands replies when reply_count > 0', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('conversations.history')) {
        return Response.json({
          ok: true,
          messages: [
            {
              ts: '1700000000.000100',
              text: 'Root architectural proposal: Migrate to Postgres',
              user: 'U_LEAD',
              reply_count: 2,
            },
          ],
        });
      }
      if (url.includes('conversations.replies')) {
        return Response.json({
          ok: true,
          messages: [
            {
              ts: '1700000000.000100',
              text: 'Root architectural proposal: Migrate to Postgres',
              user: 'U_LEAD',
            },
            {
              ts: '1700000001.000200',
              text: 'Agree, but let us keep connection pool capped at 20',
              user: 'U_DEPARTING',
              thread_ts: '1700000000.000100',
            },
          ],
        });
      }
      return Response.json({ ok: false }, { status: 404 });
    });

    vi.stubGlobal('fetch', mockFetch);

    const result = await importSlackChannels();
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts[0].text).toContain('Root architectural proposal');
    expect(result.artifacts[1].text).toContain('keep connection pool capped at 20');
    expect(result.artifacts[1].author).toBe('U_DEPARTING');
    expect(result.artifacts[1].sourceRef).toContain('thread 1700000000.000100 reply');
  });
});
