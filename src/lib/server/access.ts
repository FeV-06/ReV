import type {Run} from '@/lib/contracts';

/** This policy is a future server-side building block, not an authenticated session. */
export type RecipientPolicy={userId:string;grants:Set<string>;revoked:Set<string>};
function permitted(id:string,p:RecipientPolicy):boolean{return p.grants.has(id)&&!p.revoked.has(id);}
export function assertRecipientAccess(run:Run,policy:RecipientPolicy):void{
 if(!policy.userId||run.selectedIds.some(id=>!permitted(id,policy)))throw new Error('One or more source records are not authorised for this recipient');
 for(const item of run.items.filter(i=>!i.excluded))if(!item.derivationSourceIds?.length||item.derivationSourceIds.some(id=>!permitted(id,policy)))throw new Error('Derived item is not authorised for this recipient');
}
export function projectForRecipient(run:Run,policy:RecipientPolicy):Pick<Run,'id'|'recipient'|'createdAt'|'artifacts'|'selectedIds'|'items'|'graphEvents'|'gaps'>{
 const allowed=new Set(run.selectedIds.filter(id=>permitted(id,policy)));
 const items=run.items.filter(i=>!i.excluded&&i.derivationSourceIds?.length&&i.derivationSourceIds.every(id=>allowed.has(id))&&i.citations.every(c=>allowed.has(c.sourceId)));
 const visibleNodes=new Set([...allowed,...items.map(i=>i.id)]);
 return {id:run.id,recipient:run.recipient,createdAt:run.createdAt,artifacts:run.artifacts.filter(a=>allowed.has(a.id)),selectedIds:[...allowed],items,
  graphEvents:(run.graphEvents||[]).filter(e=>visibleNodes.has(e.edge.fromId)&&visibleNodes.has(e.edge.toId)&&e.edge.evidenceSourceIds.every(id=>allowed.has(id))),
  gaps:(run.gaps||[]).filter(g=>items.some(i=>i.id===g.itemId)&&g.sourceIds.every(id=>allowed.has(id))&&(!g.answerSourceId||allowed.has(g.answerSourceId)))};
}
