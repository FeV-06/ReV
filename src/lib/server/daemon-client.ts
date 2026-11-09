import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const stateSchema=z.object({protocol:z.literal(1),port:z.number().int().min(1).max(65535),pid:z.number().int().positive(),tokenHash:z.string().regex(/^[a-f0-9]{64}$/)});
function dataDir():string{return path.resolve(/*turbopackIgnore: true*/ process.env.REV_DATA_DIR || '.rev-data');}
export async function requestDaemon(route:string,options:{method?:string;body?:unknown}={}):Promise<Response>{
  if(!/^\/v1(?:\/|$)/.test(route)||route.includes('?')||route.includes('#'))throw new Error('Invalid daemon route');
  let state:z.infer<typeof stateSchema>;let token:string;
  try {
    state=stateSchema.parse(JSON.parse(await readFile(path.join(dataDir(),'daemon.json'),'utf8')));
    token=(await readFile(path.join(dataDir(),'daemon.token'),'utf8')).trim();
    if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Invalid daemon token');
    if(createHash('sha256').update(token).digest('hex')!==state.tokenHash)throw new Error('Mismatched daemon token');
  } catch {throw new Error('ReV daemon is unavailable; start the local daemon first');}
  try {
    return await fetch(`http://127.0.0.1:${state.port}${route}`,{method:options.method||'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body),cache:'no-store',signal:AbortSignal.timeout(160_000),redirect:'error'});
  } catch {throw new Error('ReV daemon is unavailable; start the local daemon first');}
}
export async function forwardDaemon(route:string,options:{method?:string;body?:unknown}={}):Promise<Response>{
  const upstream=await requestDaemon(route,options);const headers=new Headers({'cache-control':'no-store','x-content-type-options':'nosniff'});
  const type=upstream.headers.get('content-type');if(type)headers.set('content-type',type);
  const disposition=upstream.headers.get('content-disposition');if(disposition)headers.set('content-disposition',disposition);
  return new Response(upstream.body,{status:upstream.status,headers});
}
