import type {Item,Run} from '@/lib/contracts';

/** Verifies reference bytes, not whether the quotation semantically entails the claim. */
export function attachVerifiedCitations(run:Run,itemId:string,refs:{sourceId:string;quote:string}[]):Item{
 const item=run.items.find(i=>i.id===itemId&&!i.excluded);if(!item)throw new Error('Review item not found');
 if(!refs.length||refs.length>10)throw new Error('Provide between 1 and 10 citations');
 const selected=new Set(run.selectedIds);
 const citations=refs.map(ref=>{
  if(!selected.has(ref.sourceId))throw new Error('Citation source is not selected');
  const source=run.artifacts.find(a=>a.id===ref.sourceId);if(!source)throw new Error('Citation source not found');
  if(!ref.quote||ref.quote.length>4000)throw new Error('Citation quote is invalid');
  const offset=source.text.indexOf(ref.quote);if(offset<0)throw new Error('Exact citation quote not found');
  const startByte=Buffer.byteLength(source.text.slice(0,offset),'utf8');return {sourceId:source.id,quote:ref.quote,startByte,endByte:startByte+Buffer.byteLength(ref.quote,'utf8')};
 });
 return {...item,citations,verification:'validated_reference',needsClarification:true,derivationSourceIds:[...new Set([...(item.derivationSourceIds||[]),...refs.map(r=>r.sourceId)])]};
}
