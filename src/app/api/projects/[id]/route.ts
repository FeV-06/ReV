import {assertLocalRequest,clientError} from '@/lib/server/request-security';
import {forwardDaemon} from '@/lib/server/daemon-client';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){
 try{assertLocalRequest(request);}catch(e){return Response.json({error:clientError(e)},{status:403});}
 try{return await forwardDaemon(`/v1/projects/${encodeURIComponent((await context.params).id)}`,{method:'DELETE'});}catch(e){return Response.json({error:clientError(e)},{status:503});}
}
