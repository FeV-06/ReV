import { z } from 'zod';

const cookieName = 'rev_user_session';
const credentialSchema = z.string().regex(/^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/);

/** Parse only the opaque local user session; never accept daemon or Supabase tokens from the browser. */
export function browserUserSession(request: Request): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  const values = header.split(';').map(value => value.trim()).filter(value => value.startsWith(`${cookieName}=`));
  if (values.length !== 1) return undefined;
  const candidate = values[0].slice(cookieName.length + 1);
  const parsed = credentialSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function sessionCookie(credential: string, expiresAt: number): string {
  const value = credentialSchema.parse(credential);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error('Invalid session expiration');
  const maxAge = Math.floor((expiresAt - Date.now()) / 1000);
  return `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
