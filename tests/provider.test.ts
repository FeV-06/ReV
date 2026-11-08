import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

async function withProvider(handler:(body: any)=>any, fn:(base:string)=>Promise<void>) {
  const server:Server=createServer((req,res)=>{
    const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
      const result=handler(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
    });
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const addr=server.address();if (!addr || typeof addr==='string') throw new Error('No address');
  try { await fn(`http://127.0.0.1:${addr.port}/v1`); } finally { await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())); }
}
function core(op:object,env:Record<string,string>):Promise<any> {
  return new Promise((resolve,reject)=>{
    const p=spawn(path.resolve('target/debug/rev-core'),[],{env:{...process.env,...env}});let out='';p.stdout.setEncoding('utf8');p.stdout.on('data',c=>out+=c);p.on('error',reject);p.on('close',()=>{try{resolve(JSON.parse(out))}catch(e){reject(e)}});p.stdin.end(JSON.stringify(op));
  });
}
const sourceId=randomUUID();
const source={id:sourceId,kind:'slack_message',externalId:'1',text:'Decision: Redis',author:null,timestamp:null,url:null,sourceRef:'test'};

describe('provider protocol and failure paths (local fake server, not live inference)',()=>{
  it.each(['openai','anthropic'])('%s parses valid typed candidates and flags fabricated citations',async provider=>{
    await withProvider(body=>{
      const result=JSON.stringify({items:[{category:'decision',text:'Redis chosen',evidence:[{sourceId,quote:'Decision: Redis'}]},{category:'risk',text:'Unknown',evidence:[{sourceId,quote:'not in source'}]}]});
      expect(body.model).toBe('test-model');
      return provider==='openai'?{choices:[{message:{content:result}}]}:{content:[{type:'text',text:result}]};
    },async base=>{
      const r=await core({op:'generate',sources:[source]},{REV_MODEL_PROVIDER:provider,REV_MODEL_BASE_URL:base,REV_MODEL_NAME:'test-model'});
      expect(r.ok).toBe(true);expect(r.data.items[0].verification).toBe('validated_reference');expect(r.data.items[1].verification).toBe('unverified');
    });
  });
  it('fails explicitly on invalid model JSON',async()=>{
    await withProvider(()=>({choices:[{message:{content:'not json'}}]}),async base=>{
      const r=await core({op:'generate',sources:[source]},{REV_MODEL_PROVIDER:'openai',REV_MODEL_BASE_URL:base,REV_MODEL_NAME:'test-model'});
      expect(r.ok).toBe(false);expect(r.error).toContain('JSON');
    });
  });
  it('fails explicitly when the model service is unavailable',async()=>{
    const r=await core({op:'generate',sources:[source]},{REV_MODEL_PROVIDER:'openai',REV_MODEL_BASE_URL:'http://127.0.0.1:1/v1',REV_MODEL_NAME:'test-model'});
    expect(r.ok).toBe(false);expect(r.error).toContain('failed');
  });
  it('only returns divergence candidates with two distinct valid source references',async()=>{
    const second={...source,id:randomUUID(),externalId:'2',text:'Decision: use memory cache'};
    await withProvider(()=>({choices:[{message:{content:JSON.stringify({items:[
      {category:'risk',text:'Possible conflict',evidence:[{sourceId:source.id,quote:'Decision: Redis'},{sourceId:second.id,quote:'Decision: use memory cache'}]},
      {category:'risk',text:'Unsupported conflict',evidence:[{sourceId:source.id,quote:'Decision: Redis'},{sourceId:second.id,quote:'fabricated'}]},
    ]})}}]}),async base=>{
      const r=await core({op:'detect_divergence',sources:[source,second]},{REV_MODEL_PROVIDER:'openai',REV_MODEL_BASE_URL:base,REV_MODEL_NAME:'test-model'});
      expect(r.ok).toBe(true);expect(r.data.items).toHaveLength(1);expect(r.data.items[0].citations).toHaveLength(2);
    });
  });
});
