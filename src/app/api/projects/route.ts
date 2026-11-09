import {assertLocalRequest,clientError} from '@/lib/server/request-security';
import {forwardDaemon} from '@/lib/server/daemon-client';
import {readJsonLimited} from '@/lib/server/body';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{assertLocalRequest(request);}catch(e){return Response.json({error:clientError(e)},{status:403});}
 try{return await forwardDaemon('/v1/projects');}catch(e){return Response.json({error:clientError(e)},{status:503});}
}
export async function POST(request:Request){
 try{assertLocalRequest(request);}catch(e){return Response.json({error:clientError(e)},{status:403});}
 let body:unknown;try{body=await readJsonLimited(request,32_000);}catch(e){return Response.json({error:clientError(e)},{status:400});}
 try{return await forwardDaemon('/v1/projects',{method:'POST',body});}catch(e){return Response.json({error:clientError(e)},{status:503});}
}
