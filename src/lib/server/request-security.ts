import { z } from 'zod';

function isAllowedHost(host: string): boolean {
  if (/^(127\.0\.0\.1|localhost):3077$/.test(host)) return true;
  const publicHost = process.env.REV_PUBLIC_HOST;
  if (publicHost) {
    const allowed = publicHost.split(',').map(h => h.trim().toLowerCase());
    const incoming = host.toLowerCase();
    const incomingBase = incoming.split(':')[0];
    if (allowed.some(h => incoming === h || incomingBase === h || incomingBase.endsWith(`.${h}`))) {
      return true;
    }
  }
  return false;
}

function getOrigin(request: Request): boolean {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!host || !isAllowedHost(host)) return false;
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const parsed = new URL(origin);
      return isAllowedHost(parsed.host);
    } catch {
      return false;
    }
  }
  if (request.method !== 'GET') return false;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

export function assertLocalRequest(request: Request): void {
  if (!getOrigin(request)) throw new Error('Forbidden: request origin or host is not authorized');
  const isNav = request.method === 'GET' && (request.headers.get('sec-fetch-dest') === 'document' || request.headers.get('sec-fetch-mode') === 'navigate');
  if (!isNav && request.headers.get('x-rev-request') !== '1') throw new Error('Forbidden: missing request header');
}

export function clientError(error: unknown): string {
  return error instanceof z.ZodError ? 'Invalid request data' : error instanceof Error ? error.message : 'Operation failed';
}
