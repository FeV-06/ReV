import {assertLocalRequest,clientError} from '@/lib/server/request-security';
import {forwardDaemon} from '@/lib/server/daemon-client';
import {readJsonLimited} from '@/lib/server/body';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{assertLocalRequest(request);return await forwardDaemon(`/v1/runs/${encodeURIComponent((await context.params).id)}/refresh`,{method:'POST',body:await readJsonLimited(request,4_000_000)});}
 catch(e){return Response.json({error:clientError(e)},{status:400});}
}
