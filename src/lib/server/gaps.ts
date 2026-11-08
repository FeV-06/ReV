import { randomUUID } from 'node:crypto';
import type { Gap, Item, Run } from '@/lib/contracts';
import { buildGraph } from '@/lib/server/graph';


/** Only suggests concrete gaps already present in the data; it does not invent causes. */
export function detectGaps(run:Run):Gap[] {
  const scope=new Set(run.selectedIds);const existing=run.gaps||[];const graph=buildGraph(run);
  const visible=new Set(graph.nodes.map(n=>n.id));
  return run.items.filter(item=>!item.excluded&&visible.has(item.id)).flatMap((item:Item)=>{
    const flagged=item.needsClarification||item.verification==='unverified'||item.citations.length===0;
    if(!flagged)return [];
    const prior=existing.find(g=>g.itemId===item.id&&g.status==='open');if(prior)return [prior];
    const sourceIds=item.citations.map(c=>c.sourceId).filter(id=>scope.has(id));
    return [{id:randomUUID(),itemId:item.id,sourceIds,question:`What is the missing context or supporting evidence for: ${item.text.slice(0,240)}?`,status:'open' as const}];
  });
}
