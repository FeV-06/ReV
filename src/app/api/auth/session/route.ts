import { z } from 'zod';
import { assertLocalRequest } from '@/lib/server/request-security';
import { readJsonLimited } from '@/lib/server/body';
import { requestDaemon } from '@/lib/server/daemon-client';
import { browserUserSession, clearSessionCookie, sessionCookie } from '@/lib/server/browser-session';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request) {
  try {
    assertLocalRequest(request);
    const input=z.object({email:z.string().email().max(254),password:z.string().min(1).max(1024)}).strict().parse(await readJsonLimited(request,16_000));
    const response=await requestDaemon('/v1/auth/sign-in',{method:'POST',body:input});
    if(!response.ok)return Response.json({error:'Sign-in failed or team access is unavailable'},{status:401,headers:{'cache-control':'no-store'}});
    const result=z.object({credential:z.string(),session:z.object({expiresAt:z.number().int()}).passthrough()}).parse(await readJsonLimited(response,16_000));
    return Response.json({session:result.session},{headers:{'cache-control':'no-store','set-cookie':sessionCookie(result.credential,result.session.expiresAt)}});
  } catch {return Response.json({error:'Sign-in failed or team access is unavailable'},{status:401,headers:{'cache-control':'no-store'}});}
}

export async function GET(request:Request) {
  try {
    assertLocalRequest(request);
    const credential=browserUserSession(request);
    if(!credential)return Response.json({error:'Authentication required'},{status:401,headers:{'cache-control':'no-store'}});
    const response=await requestDaemon('/v1/auth/session',{userSession:credential});
    if(!response.ok)return Response.json({error:'Authentication required'},{status:401,headers:{'cache-control':'no-store'}});
    return Response.json(await readJsonLimited(response,16_000),{headers:{'cache-control':'no-store'}});
  } catch {return Response.json({error:'Authentication required'},{status:401,headers:{'cache-control':'no-store'}});}
}

export async function DELETE(request:Request) {
  try {
    assertLocalRequest(request);
    const credential=browserUserSession(request);
    if(credential) {
      const response=await requestDaemon('/v1/auth/sign-out',{method:'POST',userSession:credential});
      if(!response.ok) throw new Error('Could not sign out');
    }
    return Response.json({ok:true},{headers:{'cache-control':'no-store','set-cookie':clearSessionCookie()}});
  } catch {return Response.json({error:'Sign-out could not be verified'},{status:503,headers:{'cache-control':'no-store','set-cookie':clearSessionCookie()}});}
}
