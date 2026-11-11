import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TeamAuthService } from '@/lib/server/team-auth-service';

describe('team auth service',()=>{
  const teamId=randomUUID(), alice=randomUUID(), bob=randomUUID();
  const config={url:'https://example.supabase.co',publishableKey:'sb_publishable_test',teamId};
  function fakeProvider(){
    const memberships=new Map([[alice,'member'],[bob,'leader']]);
    const fake=vi.fn(async (input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.includes('/auth/v1/token')){
        const body=JSON.parse(String(init?.body));
        if(body.password!=='fixture')return new Response('',{status:401});
        return Response.json({access_token:body.email.startsWith('alice')?'token-alice':'token-bob',expires_in:60});
      }
      const authorization=(init?.headers as Record<string,string>).Authorization;
      const userId=authorization==='Bearer token-alice'?alice:authorization==='Bearer token-bob'?bob:null;
      if(url.endsWith('/auth/v1/user')) return userId?Response.json({id:userId}):new Response('',{status:401});
      if(url.includes('/rev_team_members?')) return Response.json(userId&&memberships.has(userId)?[{team_id:teamId,member_user_id:userId,member_role:memberships.get(userId)}]:[]);
      return new Response('',{status:404});
    });
    return {fake,memberships};
  }

  it('binds each session to a verified user and server-controlled membership role',async()=>{
    const {fake}=fakeProvider();const auth=new TeamAuthService(fake as typeof fetch,config);
    const a=await auth.signIn({email:'alice@example.test',password:'fixture'});
    const b=await auth.signIn({email:'bob@example.test',password:'fixture'});
    expect(a.session.user.id).toBe(alice); expect(a.session.role).toBe('member');
    expect(b.session.user.id).toBe(bob); expect(b.session.role).toBe('leader');
    expect(JSON.stringify(a.session)).not.toContain('token-alice');
    expect(await auth.require(a.credential)).toEqual({userId:alice,teamId,role:'member'});
    expect(await auth.require(b.credential)).toEqual({userId:bob,teamId,role:'leader'});
    await expect(auth.signIn({email:'alice@example.test',password:'fixture',role:'leader'})).rejects.toThrow();
  });

  it('denies revoked members and invalidates the session at logout',async()=>{
    const {fake,memberships}=fakeProvider();const auth=new TeamAuthService(fake as typeof fetch,config);
    const a=await auth.signIn({email:'alice@example.test',password:'fixture'});
    const b=await auth.signIn({email:'bob@example.test',password:'fixture'});
    memberships.delete(alice);
    await expect(auth.require(a.credential)).rejects.toThrow('revoked');
    auth.signOut(b.credential);
    await expect(auth.require(b.credential)).rejects.toThrow('Authentication required');
  });

  it('does not authorize an in-flight membership check after logout',async()=>{
    const {fake}=fakeProvider();
    let release!:()=>void;
    let block=false;
    const wait=new Promise<void>(resolve=>{release=resolve;});
    const gated=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      if(block && String(input).includes('/rev_team_members?')) await wait;
      return fake(input,init);
    });
    const auth=new TeamAuthService(gated as typeof fetch,config);
    const session=await auth.signIn({email:'alice@example.test',password:'fixture'});
    block=true;
    const pending=auth.require(session.credential);
    auth.signOut(session.credential);
    release();
    await expect(pending).rejects.toThrow('Authentication required');
  });

  it('fails closed for invalid credentials and non-members',async()=>{
    const {fake,memberships}=fakeProvider();const auth=new TeamAuthService(fake as typeof fetch,config);
    await expect(auth.signIn({email:'alice@example.test',password:'wrong'})).rejects.toThrow('Sign-in failed');
    memberships.delete(alice);
    await expect(auth.signIn({email:'alice@example.test',password:'fixture'})).rejects.toThrow('not a member');
  });
});
