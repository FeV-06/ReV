import { describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Run } from '@/lib/contracts';
import { appendEdge, buildGraph, reviewEdge } from '@/lib/server/graph';
const ids=Array.from({length:4},()=>randomUUID());
function run():Run{return {id:randomUUID(),recipient:'dev',createdAt:new Date().toISOString(),state:'needs_review',warnings:[],selectedIds:ids.slice(0,3),items:[],mode:'fixture',revision:1,approvedRevision:null,acceptedPartial:false,artifacts:ids.map((id,i)=>({id,kind:'slack_message',externalId:String(i),text:`text ${i}`,author:null,timestamp:null,url:null,sourceRef:`source ${i}`}))};}
function propose(r:Run,fromId:string,toId:string,type:'supports'|'contradicts'='supports') {const e=appendEdge(r,{fromId,toId,type,evidenceSourceIds:[ids[0]]});r.graphEvents=[...(r.graphEvents||[]),e];return e.edge.id;}
function confirm(r:Run,id:string){r.graphEvents=[...(r.graphEvents||[]),reviewEdge(r,id,'confirmed')];}
describe('evidence graph projection and replay',()=>{
 it('replays reviewed edges, excludes hidden nodes, rejects missing evidence',()=>{const r=run();const id=propose(r,ids[0],ids[1]);confirm(r,id);expect(buildGraph(r).edges[0].status).toBe('confirmed');expect(buildGraph(r).nodes.some(n=>n.id===ids[3])).toBe(false);expect(()=>appendEdge(r,{fromId:ids[0],toId:ids[3],type:'supports',evidenceSourceIds:[ids[0]]})).toThrow('visible');expect(()=>appendEdge(r,{fromId:ids[0],toId:ids[2],type:'supports',evidenceSourceIds:[ids[3]]})).toThrow('selected');});
 it('rejects a confirmed causal cycle while permitting contradiction candidates',()=>{const r=run();confirm(r,propose(r,ids[0],ids[1]));confirm(r,propose(r,ids[1],ids[2]));const cycle=propose(r,ids[2],ids[0]);expect(()=>confirm(r,cycle)).toThrow('cycle');const contradiction=propose(r,ids[2],ids[0],'contradicts');confirm(r,contradiction);expect(buildGraph(r).edges.find(e=>e.id===contradiction)?.status).toBe('confirmed');});
 it('does not expose edge when scope is narrowed',()=>{const r=run();const id=propose(r,ids[0],ids[1]);confirm(r,id);r.selectedIds=[ids[0]];expect(buildGraph(r).edges).toHaveLength(0);});
});
