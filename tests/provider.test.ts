import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { callCore } from '@/lib/server/core';
import { createRun } from '@/lib/server/store';
import { askHandover, deleteRun, exportMarkdown, updateAction } from '@/lib/server/service';
import type { Run } from '@/lib/contracts';

async function withProvider(handler:(body: any, response: ServerResponse)=>any, fn:(base:string)=>Promise<void>) {
  const server:Server=createServer((req,res)=>{
    const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
      const result=handler(JSON.parse(Buffer.concat(chunks).toString()),res);
      res.writeHead(res.statusCode,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
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
const source={id:sourceId,kind:'slack_message' as const,externalId:'1',text:'Decision: Redis',author:null,timestamp:null,url:null,sourceRef:'test'};

describe('provider protocol and failure paths (local fake server, not live inference)',()=>{
  it.each(['openai','anthropic'])('%s parses valid typed candidates and flags fabricated citations',async provider=>{
    await withProvider(body=>{
      const result=JSON.stringify({items:[{category:'decision',text:'Redis chosen',evidence:[{sourceId,quote:'Decision: Redis'}]},{category:'risk',text:'Unknown',evidence:[{sourceId,quote:'not in source'}]}]});
      expect(body.model).toBe('test-model');
      return provider==='openai'?{choices:[{message:{content:'```json\n'+result+'\n```'}}]}:{content:[{type:'text',text:result}]};
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
    expect(r.ok).toBe(false);expect(r.error).toContain('Could not connect to the model provider');
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

it('uses the confirmed takeover scope and exports only cited Day 1 actions', async () => {
  const excluded = { ...source, id: randomUUID(), externalId: 'restricted', text: 'Restricted deployment notes' };
  let run: Run = {
    id: randomUUID(), recipient: 'Incoming engineer', departingPerson: 'maya', createdAt: new Date().toISOString(),
    state: 'awaiting_scope_confirmation', artifacts: [source, excluded],
    warnings: ['Generation failed: Model request failed or timed out'], selectedIds: [source.id], items: [], mode: null, revision: 0, approvedRevision: null, acceptedPartial: false,
  };
  vi.stubEnv('REV_DATA_DIR', path.join(tmpdir(), `rev-provider-${process.pid}`));
  await createRun(run);
  try {
    const generate = { action: 'generate', selectedIds: run.selectedIds, acceptPartial: false, confirmAuthorisation: true, confirmRemote: true };
    let sent = '';
    await withProvider(body => {
      sent = body.messages[1].content;
      return { choices: [{ message: { content: JSON.stringify({ items: [
        { category: 'next_action', text: 'Inspect the Redis setup.', evidence: [{ sourceId, quote: 'Decision: Redis' }] },
        { category: 'next_action', text: 'Deploy immediately.', evidence: [{ sourceId, quote: 'fabricated' }] },
      ] }) } }] };
    }, async base => {
      vi.stubEnv('REV_MODEL_PROVIDER', 'openai');
      vi.stubEnv('REV_MODEL_BASE_URL', base);
      vi.stubEnv('REV_MODEL_NAME', 'test-model');
      run = await updateAction(run.id, { ...generate, takeoverScope: 'Billing retries' });
      expect(sent).toContain('"takeoverScope":"Billing retries"');
      run = await updateAction(run.id, { ...generate, takeoverScope: '   ' });
      expect(run.takeoverScope).toBeUndefined();
      expect(run.warnings).toEqual([]);
    });
    expect(sent).toContain('"departingPerson":"maya"');
    expect(sent).not.toContain('"takeoverScope"');
    expect(sent).not.toContain(excluded.text);
    run = await updateAction(run.id, { action: 'approve', confirmAuthorisation: true });
    const output = exportMarkdown(run);
    expect(output.split('## Handover details')[0]).toContain('## Start here');
    expect(output.split('## Handover details')[0]).toContain('Inspect the Redis setup');
    expect(output.split('## Handover details')[0]).not.toContain('Deploy immediately');
  } finally {
    await deleteRun(run.id);
    vi.unstubAllEnvs();
  }
});

it('prepares cited interview questions and rejects unsupported successor answers through Rust', async () => {
  const restricted = { ...source, id: randomUUID(), externalId: 'restricted', text: 'Restricted rollback instructions' };
  const run: Run = {
    id: randomUUID(), recipient: 'Incoming engineer', createdAt: new Date().toISOString(),
    state: 'needs_review', artifacts: [source, restricted], warnings: [], selectedIds: [source.id],
    items: [], mode: 'model', revision: 0, approvedRevision: null, acceptedPartial: false,
  };
  const requests: string[] = [];
  vi.stubEnv('REV_DATA_DIR', path.join(tmpdir(), `rev-provider-${process.pid}`));
  await createRun(run);
  try {
    await withProvider(body => {
      requests.push(body.messages[1].content);
      const prepare = body.messages[0].content.startsWith('Prepare');
      return { choices: [{ message: { content: JSON.stringify({ items: prepare ? [
        { text: 'Missing evidence field' },
        { question: 'Fabricated context?', evidence: [{ sourceId, quote: 'Wrong quote' }] },
        { question: 'Why was Redis chosen?', evidence: [{ sourceId, quote: 'Decision: Redis' }] },
      ] : [
        { category: 'next_action', text: 'Redis was chosen.', evidence: [{ sourceId, quote: 'Decision: Redis' }] },
        { category: 'unknown', text: 'What is the rollback procedure?', evidence: [] },
      ] }) } }] };
    }, async base => {
      vi.stubEnv('REV_MODEL_PROVIDER', 'openai');
      vi.stubEnv('REV_MODEL_BASE_URL', base);
      vi.stubEnv('REV_MODEL_NAME', 'test-model');
      const prepared = await updateAction(run.id, { action: 'prepare_interview', confirmRemote: true });
      expect(prepared.gaps).toHaveLength(1);
      expect(prepared.gaps).toMatchObject([{ question: 'Why was Redis chosen?', sourceIds: [sourceId] }]);
      await updateAction(run.id, { action: 'approve', confirmAuthorisation: true });
      await expect(askHandover(run.id, { question: 'What cache and how do we roll it back?' })).rejects.toThrow('Confirm');
      expect(await askHandover(run.id, { question: 'What cache and how do we roll it back?', confirmRemote: true })).toMatchObject({
        answer: 'Redis was chosen.', citations: [{ sourceId, quote: 'Decision: Redis' }], followUp: 'What is the rollback procedure?',
      });
      expect(requests).toHaveLength(2);
      expect(requests.join(' ')).not.toContain(restricted.text);
    });
    await withProvider(() => ({ choices: [{ message: { content: JSON.stringify({ items: [
      { category: 'next_action', text: 'Do a risky rollback.', evidence: [{ sourceId, quote: 'Decision: Redis' }, { sourceId, quote: 'Fabricated instructions' }] },
    ] }) } }] }), async base => {
      vi.stubEnv('REV_MODEL_BASE_URL', base);
      expect(await askHandover(run.id, { question: 'How do I roll back?', confirmRemote: true })).toMatchObject({
        answer: null, citations: [], followUp: 'How do I roll back?',
      });
    });
  } finally {
    await deleteRun(run.id);
    vi.unstubAllEnvs();
  }
});

it('retries an HTTP 413 with smaller source excerpts and preserves citation checks', async () => {
  const sizes: number[] = [];
  try {
    await withProvider((body, response) => {
      const size = Buffer.byteLength(body.messages[1].content);
      sizes.push(size);
      if (size > 3500) {
        response.statusCode = 413;
        return {};
      }
      return { choices: [{ message: { content: JSON.stringify({ items: [
        { category: 'decision', text: 'Redis chosen', evidence: [{ sourceId, quote: 'Decision: Redis' }] },
      ] }) } }] };
    }, async base => {
      vi.stubEnv('REV_DATA_DIR', path.join(tmpdir(), `rev-oversize-${process.pid}`));
      vi.stubEnv('REV_MODEL_PROVIDER', 'openai');
      vi.stubEnv('REV_MODEL_BASE_URL', base);
      vi.stubEnv('REV_MODEL_NAME', 'test-model');
      expect(await callCore({ op: 'generate', sources: [{ ...source, text: source.text.repeat(1000) }] })).toMatchObject({
        items: [{ verification: 'validated_reference' }],
      });
    });
    expect(sizes).toHaveLength(2);
    expect(sizes[1]).toBeLessThan(sizes[0]);
  } finally {
    vi.unstubAllEnvs();
  }
});
