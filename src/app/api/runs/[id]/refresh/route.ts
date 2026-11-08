import {assertLocalRequest,clientError,refreshRun} from '@/lib/server/service';
import {readJsonLimited} from '@/lib/server/body';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{assertLocalRequest(request);return Response.json({run:await refreshRun((await context.params).id,await readJsonLimited(request,4_000_000))});}
 catch(e){return Response.json({error:clientError(e)},{status:400});}
}
