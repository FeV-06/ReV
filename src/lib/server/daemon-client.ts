import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const stateSchema=z.object({protocol:z.literal(1),port:z.number().int().min(1).max(65535),pid:z.number().int().positive(),tokenHash:z.string().regex(/^[a-f0-9]{64}$/)});

async function resolveDaemonState(): Promise<{ port: number; token: string }> {
  const candidateDirs: string[] = [];
  if (process.env.REV_DATA_DIR) {
    candidateDirs.push(path.resolve(process.env.REV_DATA_DIR));
  } else {
    candidateDirs.push(path.resolve('.rev-data'));
    candidateDirs.push(path.resolve('/home/fev/GitRepos/ReV-team-sync/.rev-data'));
    candidateDirs.push(path.join(homedir(), '.rev-data'));
  }

  for (const dir of candidateDirs) {
    const metaPath = path.join(dir, 'daemon.json');
    const tokenPath = path.join(dir, 'daemon.token');
    if (!existsSync(metaPath) || !existsSync(tokenPath)) continue;
    try {
      const state = stateSchema.parse(JSON.parse(await readFile(metaPath, 'utf8')));
      const token = (await readFile(tokenPath, 'utf8')).trim();
      if (!/^[a-f0-9]{64}$/.test(token)) continue;
      if (createHash('sha256').update(token).digest('hex') !== state.tokenHash) continue;
      return { port: state.port, token };
    } catch {
      continue;
    }
  }
  throw new Error('ReV daemon is unavailable; start the local daemon first');
}

export async function requestDaemon(route:string,options:{method?:string;body?:unknown;userSession?:string}={}):Promise<Response>{
  if(!/^\/v1(?:\/|$)/.test(route)||route.includes('?')||route.includes('#'))throw new Error('Invalid daemon route');
  const { port, token } = await resolveDaemonState();
  try {
    return await fetch(`http://127.0.0.1:${port}${route}`,{method:options.method||'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(options.userSession?{'x-rev-user-session':options.userSession}:{})},body:options.body===undefined?undefined:JSON.stringify(options.body),cache:'no-store',signal:AbortSignal.timeout(160_000),redirect:'error'});
  } catch {throw new Error('ReV daemon is unavailable; start the local daemon first');}
}
export async function forwardDaemon(route:string,options:{method?:string;body?:unknown;userSession?:string}={}):Promise<Response>{
  const upstream=await requestDaemon(route,options);const headers=new Headers({'cache-control':'no-store','x-content-type-options':'nosniff'});
  const type=upstream.headers.get('content-type');if(type)headers.set('content-type',type);
  const disposition=upstream.headers.get('content-disposition');if(disposition)headers.set('content-disposition',disposition);
  return new Response(upstream.body,{status:upstream.status,headers});
}
