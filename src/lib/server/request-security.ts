import { z } from 'zod';
function getOrigin(request: Request): boolean {
  const origin = request.headers.get('origin'); const host = request.headers.get('host');
  if (!host || !/^(127\.0\.0\.1|localhost):3077$/.test(host)) return false;
  if (origin) return origin === `http://${host}`;
  if (request.method !== 'GET') return false;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
export function assertLocalRequest(request: Request): void {
  if (!getOrigin(request)) throw new Error('Forbidden: open ReV at http://127.0.0.1:3077');
  if (request.headers.get('x-rev-request') !== '1') throw new Error('Forbidden: missing request header');
}
export function clientError(error: unknown): string { return error instanceof z.ZodError ? 'Invalid request data' : error instanceof Error ? error.message : 'Operation failed'; }
