import { NextResponse } from 'next/server';
import { assertLocalRequest, clientError } from '@/lib/server/service';
import { activeSlackConnection, beginSlackOAuth, listSlackChannels, readSlackConnection, slackCookie } from '@/lib/server/slack';

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const saved = await readSlackConnection();
    if (!saved) return Response.json({ workspace: null, channels: [] });
    const connection = await activeSlackConnection();
    const channels = await listSlackChannels(connection?.token ?? saved.token);
    return Response.json({ workspace: saved.workspace, workspaceId: saved.workspaceId, channels });
  } catch (error) {
    return Response.json({ error: clientError(error) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const { url, cookie } = beginSlackOAuth(request);
    const response = NextResponse.json({ url });
    response.cookies.set(slackCookie, cookie, { httpOnly: true, sameSite: 'lax', path: '/api/slack/callback', maxAge: 600 });
    return response;
  } catch (error) {
    return Response.json({ error: clientError(error) }, { status: 400 });
  }
}
