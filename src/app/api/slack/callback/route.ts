import { NextRequest, NextResponse } from 'next/server';
import { finishSlackOAuth, resolveSlackOrigin, slackCookie } from '@/lib/server/slack';

export async function GET(request: NextRequest) {
  const origin = resolveSlackOrigin(request);
  const target = new URL('/', origin);
  try {
    const query = request.nextUrl.searchParams;
    await finishSlackOAuth(
      query.get('code') ?? '',
      query.get('state') ?? '',
      request.cookies.get(slackCookie)?.value ?? '',
      origin
    );
    target.searchParams.set('slack', 'connected');
  } catch {
    target.searchParams.set('slack', 'error');
  }
  const response = NextResponse.redirect(target);
  response.cookies.set(slackCookie, '', { path: '/api/slack/callback', maxAge: 0 });
  return response;
}
