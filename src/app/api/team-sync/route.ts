import { z } from 'zod';
import { requestDaemon } from '@/lib/server/daemon-client';
import { readJsonLimited } from '@/lib/server/body';
import { assertLocalRequest } from '@/lib/server/request-security';
import { validateSupabaseProjectUrl } from '@/lib/server/team-remote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const input = z.object({
      action: z.enum(['configure', 'status', 'preview', 'sync', 'login', 'list_teams', 'create_team', 'disconnect']),
      projectRoot: z.string().optional(),
      previewId: z.string().optional(),
      shareAnalysis: z.boolean().optional(),
      sharedRunIds: z.array(z.string()).optional(),
      confirm: z.boolean().optional(),
      url: z.string().optional(),
      publishableKey: z.string().optional(),
      accessToken: z.string().optional(),
      teamId: z.string().optional(),
      email: z.string().optional(),
      password: z.string().optional(),
      teamName: z.string().optional(),
    }).strict().parse(await readJsonLimited(request, 100_000));

    // Client-assisted 1-click Supabase onboarding actions
    if (input.action === 'login') {
      const targetUrl = validateSupabaseProjectUrl(input.url || 'https://kalmbkyxjfvatjsrjymh.supabase.co');
      const pubKey = input.publishableKey || 'sb_publishable_HxXlx-lh0nfIBOVE62sH_w_nHJz7W-O';
      if (!input.email || !input.password) {
        return Response.json({ ok: false, action: 'login', error: 'Email and password are required' }, { status: 400 });
      }

      let res: Response;
      try {
        res = await fetch(`${targetUrl}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: pubKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: input.email.trim(), password: input.password }),
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        return Response.json({ ok: false, action: 'login', error: 'Could not connect to Supabase Auth' }, { status: 502 });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorMsg = data.error_description || data.msg || 'Sign in failed. Check your credentials.';
        return Response.json({ ok: false, action: 'login', error: errorMsg }, { status: res.status });
      }

      return Response.json({
        ok: true,
        action: 'login',
        accessToken: data.access_token,
        user: { id: data.user?.id, email: data.user?.email },
      });
    }

    if (input.action === 'list_teams') {
      const targetUrl = validateSupabaseProjectUrl(input.url || 'https://kalmbkyxjfvatjsrjymh.supabase.co');
      const pubKey = input.publishableKey || 'sb_publishable_HxXlx-lh0nfIBOVE62sH_w_nHJz7W-O';
      if (!input.accessToken) {
        return Response.json({ ok: false, action: 'list_teams', error: 'Access token required' }, { status: 400 });
      }

      let res: Response;
      try {
        res = await fetch(`${targetUrl}/rest/v1/rev_team_members?select=team_id,member_role,rev_teams(id,team_name)`, {
          headers: {
            apikey: pubKey,
            Authorization: `Bearer ${input.accessToken}`,
          },
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        return Response.json({ ok: false, action: 'list_teams', error: 'Could not fetch teams' }, { status: 502 });
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        return Response.json({ ok: false, action: 'list_teams', error: `Supabase query failed: ${errorText}` }, { status: res.status });
      }

      const rows = (await res.json()) as any[];
      const teams = Array.isArray(rows)
        ? rows.map(r => ({
            id: r.team_id,
            name: r.rev_teams?.team_name || 'Team',
            role: r.member_role,
          }))
        : [];

      return Response.json({ ok: true, action: 'list_teams', teams });
    }

    if (input.action === 'create_team') {
      const targetUrl = validateSupabaseProjectUrl(input.url || 'https://kalmbkyxjfvatjsrjymh.supabase.co');
      const pubKey = input.publishableKey || 'sb_publishable_HxXlx-lh0nfIBOVE62sH_w_nHJz7W-O';
      if (!input.accessToken) {
        return Response.json({ ok: false, action: 'create_team', error: 'Access token required' }, { status: 400 });
      }
      const name = (input.teamName || 'ReV Core Team').trim();

      let res: Response;
      try {
        res = await fetch(`${targetUrl}/rest/v1/rpc/rev_create_team`, {
          method: 'POST',
          headers: {
            apikey: pubKey,
            Authorization: `Bearer ${input.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ p_team_name: name }),
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        return Response.json({ ok: false, action: 'create_team', error: 'Could not reach Supabase RPC' }, { status: 502 });
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        return Response.json({ ok: false, action: 'create_team', error: `Create team failed: ${errorText}` }, { status: res.status });
      }

      const created = await res.json();
      const item = Array.isArray(created) ? created[0] : created;
      return Response.json({
        ok: true,
        action: 'create_team',
        team: { id: item?.team_id, name: item?.team_name },
      });
    }

    const { action, ...payload } = input;
    return await requestDaemon('/v1/team-sync', { method: 'POST', body: { action, payload } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not reach the team service or invalid request.';
    return Response.json({ ok: false, action: 'unknown', error: message }, { status: 400 });
  }
}
