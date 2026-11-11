import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export interface VerifiedUser {
  id: string;
  email?: string;
}

export interface AuthSession {
  readonly id: string;
  readonly user: VerifiedUser;
  readonly expiresAt: number;
}

interface StoredSession extends AuthSession {
  readonly tokenHash: Buffer;
  readonly teamAccessToken: string;
}

export interface SessionRegistryOptions {
  verify: (token: string) => Promise<VerifiedUser>;
  now?: () => number;
  lifetimeMs?: number;
}

/** Opaque per-user sessions; Supabase identity verification is injected, never decoded without validation. */
export class SessionRegistry {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly now: () => number;
  private readonly lifetimeMs: number;

  constructor(private readonly options: SessionRegistryOptions) {
    this.now = options.now ?? Date.now;
    this.lifetimeMs = options.lifetimeMs ?? 30 * 60_000;
    if (!Number.isSafeInteger(this.lifetimeMs) || this.lifetimeMs <= 0 || this.lifetimeMs > 24 * 60 * 60_000) throw new Error('Invalid local session lifetime');
  }

  async establish(teamAccessToken: string, providerExpiresAt: number): Promise<{ session: AuthSession; credential: string }> {
    if (typeof teamAccessToken !== 'string' || teamAccessToken.length === 0 || teamAccessToken.length > 8192) throw new Error('Invalid identity token');
    if (!Number.isSafeInteger(providerExpiresAt) || providerExpiresAt <= this.now()) throw new Error('Provider session has expired');
    const user = await this.options.verify(teamAccessToken);
    if (!user || typeof user.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)) throw new Error('Identity provider returned an invalid user');
    const credential = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(credential).digest();
    const id = randomBytes(16).toString('hex');
    const expiresAt = Math.min(this.now() + this.lifetimeMs, providerExpiresAt);
    const session: StoredSession = { id, user: { id: user.id, ...(user.email ? { email: user.email } : {}) }, expiresAt, tokenHash, teamAccessToken };
    this.sessions.set(id, session);
    return { session: this.publicSession(session), credential: `${id}.${credential}` };
  }

  require(credential: string | undefined): AuthSession {
    const session = this.find(credential);
    return this.publicSession(session);
  }

  /** Access token is returned only to trusted server-side operations. */
  providerToken(credential: string | undefined): string { return this.find(credential).teamAccessToken; }

  revoke(credential: string | undefined): void {
    const session = this.find(credential);
    this.sessions.delete(session.id);
  }

  clear(): void { this.sessions.clear(); }

  private find(credential: string | undefined): StoredSession {
    if (!credential || !/^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(credential)) throw new Error('Authentication required');
    const [id, secret] = credential.split('.');
    const session = this.sessions.get(id);
    const supplied = createHash('sha256').update(secret).digest();
    const expected = session?.tokenHash ?? Buffer.alloc(32);
    const matches = timingSafeEqual(supplied, expected);
    if (!session || !matches) throw new Error('Authentication required');
    if (this.now() >= session.expiresAt) {
      this.sessions.delete(id);
      throw new Error('Session expired; sign in again');
    }
    return session;
  }

  private publicSession(session: StoredSession): AuthSession {
    return { id: session.id, user: { ...session.user }, expiresAt: session.expiresAt };
  }
}
