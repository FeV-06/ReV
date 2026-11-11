import { z } from 'zod';
import { readJsonLimited } from '@/lib/server/body';
import { SessionRegistry, type AuthSession } from '@/lib/server/auth-sessions';
import { verifySupabaseIdentity } from '@/lib/server/supabase-identity';
import { verifySupabaseMembership } from '@/lib/server/supabase-membership';
import { validateSupabaseProjectUrl } from '@/lib/server/team-remote';
import type { RunAuthority } from '@/lib/server/store';

const configuration = z.object({ url:z.string().url(), publishableKey:z.string().startsWith('sb_publishable_').max(2048), teamId:z.string().uuid() }).strict();
const tokenResponse = z.object({ access_token:z.string().min(1).max(8192), expires_in:z.number().int().positive().max(86_400) });

type Config = z.infer<typeof configuration>;
export interface PublicTeamSession extends AuthSession { teamId:string; role:'leader'|'member' }

/** Per-user daemon sessions; the provider, never caller claims, supplies identity and role. */
export class TeamAuthService {
  private readonly registries = new Map<string, { registry:SessionRegistry; config:Config }>();
  constructor(private readonly fetchImpl:typeof fetch = fetch, private readonly allowedConfig?:Config) {}

  async signIn(raw:unknown):Promise<{ credential:string; session:PublicTeamSession }> {
    const input = z.object({ email:z.string().email().max(254), password:z.string().min(1).max(1024) }).strict().parse(raw);
    if (!this.allowedConfig) throw new Error('Team configuration is not set');
    const config:Config = { ...this.allowedConfig, url:validateSupabaseProjectUrl(this.allowedConfig.url) };
    let response:Response;
    try {
      response = await this.fetchImpl(`${config.url}/auth/v1/token?grant_type=password`, {
        method:'POST', headers:{ apikey:config.publishableKey, 'Content-Type':'application/json' },
        body:JSON.stringify({ email:input.email, password:input.password }), redirect:'error', cache:'no-store', signal:AbortSignal.timeout(15_000),
      });
    } catch { throw new Error('Identity provider is unavailable'); }
    if (!response.ok) throw new Error('Sign-in failed; check your credentials');
    const parsed = tokenResponse.safeParse(await readJsonLimited(response, 64_000));
    if (!parsed.success) throw new Error('Identity provider returned an invalid session');
    const now = Date.now();
    const registry = new SessionRegistry({
      verify: token => verifySupabaseIdentity({ ...config, accessToken:token, fetchImpl:this.fetchImpl }),
    });
    const issued = await registry.establish(parsed.data.access_token, now + parsed.data.expires_in * 1000);
    const role = await verifySupabaseMembership({ ...config, accessToken:parsed.data.access_token,
      principal:{ id:issued.session.user.id, teamId:config.teamId }, fetchImpl:this.fetchImpl });
    if (!role) { registry.clear(); throw new Error('This account is not a member of the selected team'); }
    this.registries.set(issued.session.id,{registry,config});
    return { credential:issued.credential, session:{ ...issued.session, teamId:config.teamId, role } };
  }

  async require(credential:string|undefined):Promise<RunAuthority> {
    if (!credential) throw new Error('Authentication required');
    const entry=this.registries.get(credential.split('.')[0]);
    if (!entry) throw new Error('Authentication required');
    let session:AuthSession;
    let token:string;
    session=entry.registry.require(credential);
    token=entry.registry.providerToken(credential);
    const principal={id:session.user.id,teamId:entry.config.teamId};
    const role=await verifySupabaseMembership({ ...entry.config, accessToken:token, principal, fetchImpl:this.fetchImpl });
    // Logout or expiration can happen while the membership request is in flight.
    if (this.registries.get(session.id)!==entry) throw new Error('Authentication required');
    entry.registry.require(credential);
    if (!role) { entry.registry.revoke(credential); this.registries.delete(session.id); throw new Error('Team membership revoked'); }
    return {userId:principal.id,teamId:principal.teamId,role};
  }

  async current(credential:string|undefined):Promise<PublicTeamSession> {
    const authority = await this.require(credential);
    const entry=this.registries.get(credential!.split('.')[0]);
    if (!entry) throw new Error('Authentication required');
    const session=entry.registry.require(credential);
    return { ...session, teamId:authority.teamId, role:authority.role };
  }

  signOut(credential:string|undefined):void {
    if (!credential) return;
    const entry=this.registries.get(credential.split('.')[0]);
    if (!entry) return;
    const session=entry.registry.require(credential);
    entry.registry.revoke(credential);
    this.registries.delete(session.id);
  }

  clear():void { for (const entry of this.registries.values()) entry.registry.clear(); this.registries.clear(); }
}
