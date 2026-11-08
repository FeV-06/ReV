import {describe,it,expect} from 'vitest';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {newRun,updateAction,deleteRun,readGraph,exportMarkdown} from '@/lib/server/service';
process.env.REV_DATA_DIR=path.join(tmpdir(),`rev-divergence-${process.pid}`);
describe('divergence review workflow',()=>{
 it('passes selected sources to provider, records two-sided candidate, and invalidates approval',async()=>{
  let seen:string[]=[];
  const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
   const payload=JSON.parse(body);const text=payload.messages[1].content;const sources=JSON.parse(text.substring(text.indexOf('[')));seen=sources.map((s:{id:string})=>s.id);
   const result={items:[{category:'risk',text:'Potential disagreement; verify the context.',evidence:sources.slice(0,2).map((s:{id:string;text:string})=>({sourceId:s.id,quote:s.text}))}]};
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));
  });});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();if(!addr||typeof addr==='string')throw new Error('missing address');
  const before={...process.env};process.env.REV_MODEL_PROVIDER='openai';process.env.REV_MODEL_BASE_URL=`http://127.0.0.1:${addr.port}/v1`;process.env.REV_MODEL_NAME='fixture-model';
  try {
   let run=await newRun({recipient:'dev',fixture:true});const selectedIds=run.artifacts.slice(0,2).map(a=>a.id);
   run=await updateAction(run.id,{action:'scope',selectedIds});run=await updateAction(run.id,{action:'generate',selectedIds,acceptPartial:false,confirmAuthorisation:true,fixture:true});
   run=await updateAction(run.id,{action:'approve',confirmAuthorisation:true});expect(exportMarkdown(run)).toContain('Handover');
   run=await updateAction(run.id,{action:'detect_divergence',selectedIds,confirmRemote:true});
   expect(seen.sort()).toEqual(selectedIds.sort());expect(run.state).toBe('needs_review');expect(run.items.at(-1)?.needsClarification).toBe(true);expect(run.items.at(-1)?.citations).toHaveLength(2);expect(()=>exportMarkdown(run)).toThrow('Approve');expect((await readGraph(run.id)).edges.length).toBeGreaterThan(0);
   await deleteRun(run.id);
  } finally {process.env=before;await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
 });
});
