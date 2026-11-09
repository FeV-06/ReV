import {randomUUID} from 'node:crypto';
import type {Artifact,Run} from '@/lib/contracts';

type Change={key:string;oldId?:string;newId?:string};
export type RefreshPlan={added:Change[];changed:Change[];unchanged:Change[];missing:Change[];revoked:Change[]};
function key(a:Artifact):string{return `${a.kind}:${a.externalId}`;}
function signature(a:Artifact):string{return JSON.stringify([a.kind,a.externalId,a.text,a.author,a.timestamp,a.url,a.sourceRef,a.paths]);}
export function planRefresh(run:Run,incoming:Artifact[],revokedIds:string[]):RefreshPlan{
 const old=new Map(run.artifacts.map(a=>[key(a),a]));const next=new Map<string,Artifact>();const oldIds=new Map(run.artifacts.map(a=>[a.id,key(a)]));const incomingIds=new Set<string>();
 if(old.size!==run.artifacts.length||oldIds.size!==run.artifacts.length)throw new Error('Prior snapshot contains duplicate source identities');
 for(const a of incoming){const k=key(a);if(next.has(k)||incomingIds.has(a.id)||(oldIds.has(a.id)&&oldIds.get(a.id)!==k))throw new Error(`Duplicate incoming source identity: ${k}`);next.set(k,a);incomingIds.add(a.id);}
 if(revokedIds.some(id=>!run.artifacts.some(a=>a.id===id)))throw new Error('Revoked source is not in prior snapshot');
 const out:RefreshPlan={added:[],changed:[],unchanged:[],missing:[],revoked:[]};
 for(const [k,a] of next){const prev=old.get(k);if(!prev)out.added.push({key:k,newId:a.id});else if(signature(prev)===signature(a))out.unchanged.push({key:k,oldId:prev.id,newId:a.id});else out.changed.push({key:k,oldId:prev.id,newId:a.id});}
 for(const [k,a] of old)if(!next.has(k))out.missing.push({key:k,oldId:a.id});
 for(const id of new Set(revokedIds)){const a=run.artifacts.find(a=>a.id===id)!;out.revoked.push({key:key(a),oldId:id});}
 return out;
}

/** Produces a new immutable snapshot. Missing in a partial import is not deletion. */
export function applyRefresh(run:Run,incoming:Artifact[],revokedIds:string[]):Run{
 const plan=planRefresh(run,incoming,revokedIds);const oldByKey=new Map(run.artifacts.map(a=>[key(a),a]));const revoked=new Set(plan.revoked.map(x=>x.key));
 const incomingKeys=new Set(incoming.map(key));
 const artifacts=[...incoming.filter(a=>!revoked.has(key(a))).map(a=>{const old=oldByKey.get(key(a));return old&&signature(old)===signature(a)?old:{...a,id:randomUUID()};}),...run.artifacts.filter(a=>!incomingKeys.has(key(a))&&!revoked.has(key(a)))];
 const safePrior=new Set(plan.unchanged.filter(x=>!revoked.has(x.key)).map(x=>x.oldId));
 const selectedIds=run.selectedIds.filter(id=>safePrior.has(id));
 // Prior approved exports become unsafe if a source changes or access is revoked.
 // This function only creates a new snapshot and cannot revoke the old one.
 if(plan.changed.some(c=>run.selectedIds.includes(c.oldId!))||plan.revoked.some(c=>run.selectedIds.includes(c.oldId!)))throw new Error('Changed or revoked selected sources require atomic invalidation of prior approvals; refresh is not yet available');
 return {id:randomUUID(),recipient:run.recipient,departingPerson:run.departingPerson,takeoverScope:run.takeoverScope,createdAt:new Date().toISOString(),state:'awaiting_scope_confirmation',artifacts,warnings:plan.missing.length?[`${plan.missing.length} prior source records were not observed; they were retained but not selected.`]:[],selectedIds,items:[],mode:run.mode,revision:0,approvedRevision:null,acceptedPartial:false,graphEpoch:randomUUID(),graphEvents:[],gaps:[]};
}
