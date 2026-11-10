import { randomUUID } from 'node:crypto';
import type { Gap, Item, Run } from '@/lib/contracts';
import { buildGraph } from '@/lib/server/graph';


/** Only suggests concrete gaps already present in the data; it does not invent causes. */
export function detectGaps(run:Run, includeOpenWork = false):Gap[] {
  const scope=new Set(run.selectedIds);const existing=run.gaps||[];const graph=buildGraph(run);
  const visible=new Set(graph.nodes.map(n=>n.id));
  return run.items.filter(item=>!item.excluded&&visible.has(item.id)).flatMap((item:Item)=>{
    const flagged=item.needsClarification||item.verification==='unverified'||item.citations.length===0;
    const openWork = includeOpenWork && ['open_work', 'next_action', 'risk'].includes(item.category);
    if (!flagged && !openWork) return [];
    const sourceIds=item.citations.map(c=>c.sourceId).filter(id=>scope.has(id));
    const context = item.text.replace(/^Fixture example(?: \(not model inference\))?:\s*/, '').slice(0, 240);
    const question = flagged
      ? `What is the missing context or supporting evidence for: ${context}?`
      : `What should the successor do first, and how will they know this work is done? Context: ${context}`;
    const prior=existing.find(g=>g.itemId===item.id&&g.status==='open'&&g.question===question&&g.sourceIds.slice().sort().join(',')===sourceIds.slice().sort().join(','));if(prior)return [prior];
    return [{id:randomUUID(),itemId:item.id,sourceIds,question,status:'open' as const}];
  });
}
