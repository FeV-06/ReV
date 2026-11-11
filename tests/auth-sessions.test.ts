import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SessionRegistry } from '@/lib/server/auth-sessions';

describe('verified local auth sessions', () => {
  it('requires a verified provider identity; untrusted claims cannot choose a user', async () => {
    const verify = vi.fn().mockRejectedValue(new Error('invalid signature'));
    const registry = new SessionRegistry({ verify });
    await expect(registry.establish('forged-identity-token', Date.now() + 60_000)).rejects.toThrow('invalid signature');
    expect(verify).toHaveBeenCalledOnce();
    expect(() => registry.require('forged')).toThrow('Authentication required');
  });

  it('isolates two users, stores opaque local credentials, rejects tampering, and revokes only one session', async () => {
    const a = randomUUID(), b = randomUUID();
    const registry = new SessionRegistry({ verify: async token => ({ id: token === 'provider-a' ? a : b }) });
    const alice = await registry.establish('provider-a', Date.now() + 60_000);
    const bob = await registry.establish('provider-b', Date.now() + 60_000);
    expect(registry.require(alice.credential).user.id).toBe(a);
    expect(registry.require(bob.credential).user.id).toBe(b);
    expect(JSON.stringify(alice.session)).not.toContain('provider-a');
    expect(registry.providerToken(alice.credential)).toBe('provider-a');
    const [id, secret] = alice.credential.split('.');
    const wrong = `${id}.${secret[0] === 'A' ? 'B' : 'A'}${secret.slice(1)}`;
    expect(() => registry.require(wrong)).toThrow('Authentication required');
    registry.revoke(alice.credential);
    expect(() => registry.require(alice.credential)).toThrow('Authentication required');
    expect(registry.require(bob.credential).user.id).toBe(b);
  });

  it('expires without a refresh token, and invalidates all sessions on clear', async () => {
    let now = 1000;
    const registry = new SessionRegistry({ verify: async () => ({ id: randomUUID() }), now: () => now, lifetimeMs: 100 });
    const first = await registry.establish('provider-token', 2000);
    expect(registry.require(first.credential).expiresAt).toBe(1100);
    now = 1100;
    expect(() => registry.require(first.credential)).toThrow('Session expired');
    const second = await registry.establish('provider-token', 2000);
    registry.clear();
    expect(() => registry.require(second.credential)).toThrow('Authentication required');
  });

  it('never lets the local session outlive the provider session', async () => {
    let now = 1000;
    const registry = new SessionRegistry({ verify: async () => ({ id: randomUUID() }), now: () => now, lifetimeMs: 500 });
    const session = await registry.establish('provider-token', 1050);
    expect(session.session.expiresAt).toBe(1050);
    now = 1050;
    expect(() => registry.require(session.credential)).toThrow('Session expired');
    await expect(registry.establish('provider-token', 1049)).rejects.toThrow('Provider session has expired');
  });

  it('does not create a local session when provider returns a malformed identity', async () => {
    const registry = new SessionRegistry({ verify: async () => ({ id: 'not-a-user' }) });
    await expect(registry.establish('provider-token', Date.now() + 60_000)).rejects.toThrow('invalid user');
  });
});
