import { NextRequest, NextResponse } from 'next/server';
import { finishSlackOAuth, slackCookie, slackOrigin } from '@/lib/server/slack';

export async function GET(request: NextRequest) {
  if (request.headers.get('host') !== 'localhost:3077') return new Response('Invalid Slack callback host.', { status: 403 });
  const target = new URL('/', slackOrigin);
  try {
    const query = request.nextUrl.searchParams;
    await finishSlackOAuth(query.get('code') ?? '', query.get('state') ?? '', request.cookies.get(slackCookie)?.value ?? '');
    target.searchParams.set('slack', 'connected');
  } catch {
    target.searchParams.set('slack', 'error');
  }
  const response = NextResponse.redirect(target);
  response.cookies.set(slackCookie, '', { path: '/api/slack/callback', maxAge: 0 });
  return response;
}
