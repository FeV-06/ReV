import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {planRefresh,applyRefresh} from '@/lib/server/refresh';
import type {Artifact,Run} from '@/lib/contracts';
function artifact(externalId:string,text:string):Artifact{return {id:randomUUID(),kind:'github_commit',externalId,text,author:'A',timestamp:null,url:null,sourceRef:externalId};}
function fixture():Run{const a=artifact('a','old'),b=artifact('b','unchanged');return {id:randomUUID(),recipient:'dev',createdAt:new Date().toISOString(),state:'approved',artifacts:[a,b],warnings:[],selectedIds:[a.id,b.id],items:[{id:randomUUID(),category:'decision',text:'old claim',citations:[],verification:'unverified',excluded:false,needsClarification:false,derivationSourceIds:[a.id,b.id]}],mode:'model',revision:1,approvedRevision:1,acceptedPartial:false};}
describe('incremental source refresh',()=>{
 it('distinguishes new, changed, unchanged, and explicitly revoked records',()=>{const r=fixture();const incoming=[artifact('a','new'),artifact('b','unchanged'),artifact('c','added')];const plan=planRefresh(r,incoming,[r.artifacts[1].id]);expect(plan.changed).toHaveLength(1);expect(plan.unchanged).toHaveLength(1);expect(plan.added).toHaveLength(1);expect(plan.revoked).toHaveLength(1);});
 it('fails closed if a selected source changes and prior approval cannot be atomically invalidated',()=>{const r=fixture();const old=structuredClone(r);expect(()=>applyRefresh(r,[artifact('a','new'),artifact('b','unchanged'),artifact('c','added')],[])).toThrow('atomic invalidation');expect(r).toEqual(old);});
 it('never treats absent records in a partial fetch as deleted',()=>{const r=fixture();const plan=planRefresh(r,[artifact('a','old')],[]);expect(plan.missing).toHaveLength(1);const next=applyRefresh(r,[artifact('a','old')],[]);expect(next.artifacts.some(a=>a.externalId==='b')).toBe(true);expect(next.warnings.join(' ')).toContain('not observed');});
 it('fails closed when selected access is revoked',()=>{const r=fixture();expect(()=>applyRefresh(r,[artifact('a','old'),artifact('b','unchanged')],[r.artifacts[1].id])).toThrow('atomic invalidation');});
 it('allocates a fresh identity when an unselected source changes even if an adapter reuses an ID',()=>{const r=fixture();const changed={...r.artifacts[0],text:'new'};r.selectedIds=[r.artifacts[1].id];const next=applyRefresh(r,[changed,artifact('b','unchanged')],[]);expect(next.artifacts.find(a=>a.externalId==='a')!.id).not.toBe(changed.id);});
});
