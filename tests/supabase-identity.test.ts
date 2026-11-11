import { describe, expect, it, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { verifySupabaseIdentity } from '@/lib/server/supabase-identity';

afterEach(() => vi.unstubAllGlobals());

describe('Supabase identity verification', () => {
  const input = { url: 'https://project.supabase.co', publishableKey: 'sb_publishable_test', accessToken: 'signed-session' };

  it('asks the configured provider to verify the user instead of trusting local claims', async () => {
    const id = randomUUID();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id, email: 'member@example.test' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifySupabaseIdentity(input)).resolves.toEqual({ id, email: 'member@example.test' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://project.supabase.co/auth/v1/user');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error', cache: 'no-store' });
  });

  it('fails closed for a rejected or expired token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    await expect(verifySupabaseIdentity(input)).rejects.toThrow('Authentication failed');
  });

  it('rejects untrusted endpoints and privileged keys before network access', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifySupabaseIdentity({ ...input, url: 'https://evil.example' })).rejects.toThrow('Supabase project URL');
    await expect(verifySupabaseIdentity({ ...input, publishableKey: 'sb_secret_do_not_use' })).rejects.toThrow('publishable key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed and oversized provider responses', async () => {
    const mock = vi.fn().mockResolvedValueOnce(Response.json({ id: 'invalid' })).mockResolvedValueOnce(new Response('x'.repeat(64_001)));
    vi.stubGlobal('fetch', mock);
    await expect(verifySupabaseIdentity(input)).rejects.toThrow('invalid data');
    await expect(verifySupabaseIdentity(input)).rejects.toThrow('too large');
  });
});
