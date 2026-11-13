import { describe, it, expect } from 'vitest';
import { resolveSlackOrigin, getSlackCallback, beginSlackOAuth } from '../src/lib/server/slack';

describe('Slack Dynamic OAuth Origin Resolution', () => {
  it('falls back to default localhost:3077 when no request or env is set', () => {
    delete process.env.REV_PUBLIC_HOST;
    const origin = resolveSlackOrigin();
    expect(origin).toBe('http://localhost:3077');
    expect(getSlackCallback(origin)).toBe('http://localhost:3077/api/slack/callback');
  });

  it('respects REV_PUBLIC_HOST when configured for tunnels or production', () => {
    process.env.REV_PUBLIC_HOST = 'rev.fev06.xyz';
    const origin = resolveSlackOrigin();
    expect(origin).toBe('https://rev.fev06.xyz');
    expect(getSlackCallback(origin)).toBe('https://rev.fev06.xyz/api/slack/callback');
    delete process.env.REV_PUBLIC_HOST;
  });

  it('resolves dynamic host from incoming Request headers', () => {
    const req = new Request('http://example.com/api/slack', {
      headers: {
        host: 'rev-internal.corp.net:8443',
        'x-forwarded-proto': 'https',
      },
    });
    const origin = resolveSlackOrigin(req);
    expect(origin).toBe('https://rev-internal.corp.net:8443');
    expect(getSlackCallback(origin)).toBe('https://rev-internal.corp.net:8443/api/slack/callback');
  });

  it('generates Slack OAuth authorize URL using the dynamic callback', () => {
    process.env.REV_SLACK_CLIENT_ID = 'test-client-123';
    const req = new Request('http://example.com/api/slack', {
      headers: {
        host: 'rev.custom.domain',
        'x-forwarded-proto': 'https',
      },
    });
    const { url, origin } = beginSlackOAuth(req);
    expect(origin).toBe('https://rev.custom.domain');
    expect(url).toContain('redirect_uri=https%3A%2F%2Frev.custom.domain%2Fapi%2Fslack%2Fcallback');
    delete process.env.REV_SLACK_CLIENT_ID;
  });
});
