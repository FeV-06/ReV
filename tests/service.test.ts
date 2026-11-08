import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assertLocalRequest, exportMarkdown } from '@/lib/server/service';
import type { Run } from '@/lib/contracts';
const id=randomUUID(), sourceId=randomUUID();
function run(): Run { return { id,recipient:'Engineer',createdAt:'2026-11-08T00:00:00Z',state:'approved',selectedIds:[sourceId],warnings:[],mode:'model',revision:1,approvedRevision:1,acceptedPartial:false,artifacts:[{id:sourceId,kind:'slack_message',externalId:'1',text:'Decision: Redis',author:null,timestamp:null,url:null,sourceRef:'engineering:1'}],items:[{id:randomUUID(),category:'decision',text:'Use Redis',citations:[{sourceId,quote:'Decision: Redis',startByte:0,endByte:15}],verification:'validated_reference',excluded:false,needsClarification:false,derivationSourceIds:[sourceId]}]}; }
describe('handover export',()=>{
  it('refuses unapproved revisions',()=>{const r=run();r.approvedRevision=0;expect(()=>exportMarkdown(r)).toThrow('Approve');});
  it('does not export excluded content or its citations',()=>{const r=run();r.items[0].excluded=true;const out=exportMarkdown(r);expect(out).not.toContain('Use Redis');expect(out).not.toContain('Decision: Redis');});
  it('blocks citations outside selected scope',()=>{const r=run();r.selectedIds=[];expect(()=>exportMarkdown(r)).toThrow('authorised scope');});
  it('escapes model-authored HTML',()=>{const r=run();r.items[0].text='<script>alert(1)</script>';expect(exportMarkdown(r)).not.toContain('<script>');});
  it('omits citations for unverified statements',()=>{const r=run();r.items[0].verification='unverified';expect(exportMarkdown(r)).not.toContain('Decision: Redis');});
  it('does not interpret source text or warning details as markup or links',()=>{const r=run();r.warnings=['Private restricted-project/secret.json failed'];r.items[0].text='![leak](https://evil.example/a) **bold** `code`';const out=exportMarkdown(r);expect(out).not.toContain('restricted-project/secret.json');expect(out).not.toContain('![leak]');expect(out).toContain('incomplete');});
});
describe('local request boundary',()=>{
  it('allows same-origin POST with marker',()=>expect(()=>assertLocalRequest(new Request('http://127.0.0.1:3077/api/runs',{method:'POST',headers:{host:'127.0.0.1:3077',origin:'http://127.0.0.1:3077','x-rev-request':'1'}}))).not.toThrow());
  it('rejects cross-origin and missing marker',()=>{expect(()=>assertLocalRequest(new Request('http://127.0.0.1:3077/api/runs',{method:'POST',headers:{host:'127.0.0.1:3077',origin:'https://evil.example','x-rev-request':'1'}}))).toThrow();expect(()=>assertLocalRequest(new Request('http://127.0.0.1:3077/api/runs',{headers:{host:'127.0.0.1:3077','sec-fetch-site':'same-origin'}}))).toThrow();});
});
