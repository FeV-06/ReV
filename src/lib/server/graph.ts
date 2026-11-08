import { randomUUID } from 'node:crypto';
import type { GraphEdge, GraphEvent, Run } from '@/lib/contracts';

type GraphNode = {id:string; kind:string; label:string; timestamp:string|null; sourceIds:string[]};
export type KnowledgeGraph = {nodes:GraphNode[]; edges:GraphEdge[]};

/** A graph is replayed from the run snapshot and append-only review events. */
export function buildGraph(run:Run): KnowledgeGraph {
  const scope=new Set(run.selectedIds);
  const nodes:GraphNode[]=[
    ...run.artifacts.filter(a=>scope.has(a.id)).map(a=>({id:a.id,kind:'source',label:a.sourceRef,timestamp:a.timestamp,sourceIds:[a.id]})),
    ...run.items.filter(i=>!i.excluded && i.derivationSourceIds?.every(id=>scope.has(id))).map(i=>({id:i.id,kind:i.category,label:i.text,timestamp:null,sourceIds:i.derivationSourceIds||[]})),
  ];
  const ids=new Set(nodes.map(n=>n.id));
  const latest=new Map<string,GraphEdge>();
  const currentVersion=(event:GraphEvent)=>!run.graphEpoch || event.epoch===run.graphEpoch;
  for(const event of run.graphEvents||[]) if(currentVersion(event)) latest.set(event.edge.id,event.edge);
  const edges=[...latest.values()].filter(e=>ids.has(e.fromId)&&ids.has(e.toId)&&e.evidenceSourceIds.every(id=>scope.has(id)));
  return {nodes,edges};
}

export function suggestEvidenceEdges(run:Run):GraphEvent[] {
  const visible=buildGraph(run);const sourceIds=new Set(visible.nodes.filter(n=>n.kind==='source').map(n=>n.id));
  const epoch=run.graphEpoch;const now=new Date().toISOString();const out:GraphEvent[]=[];
  for(const item of run.items) {
    if(item.excluded||!visible.nodes.some(n=>n.id===item.id))continue;
    for(const sourceId of new Set(item.citations.map(c=>c.sourceId))) {
      if(!sourceIds.has(sourceId))continue;
      const edge:GraphEdge={id:randomUUID(),fromId:sourceId,toId:item.id,type:'supports',evidenceSourceIds:[sourceId],status:'proposed',createdAt:now};
      out.push({id:randomUUID(),type:'edge_proposed',edge,at:now,epoch});
    }
  }
  return out;
}

export function appendEdge(run:Run,input:{fromId:string;toId:string;type:GraphEdge['type'];evidenceSourceIds:string[]}):GraphEvent {
  const graph=buildGraph(run);const ids=new Set(graph.nodes.map(n=>n.id));const scope=new Set(run.selectedIds);
  if(!ids.has(input.fromId)||!ids.has(input.toId)||input.fromId===input.toId)throw new Error('Graph endpoints must be distinct visible nodes');
  if(!input.evidenceSourceIds.length||new Set(input.evidenceSourceIds).size!==input.evidenceSourceIds.length||input.evidenceSourceIds.some(id=>!scope.has(id)))throw new Error('Graph evidence must consist of selected sources');
  if(graph.edges.some(e=>e.fromId===input.fromId&&e.toId===input.toId&&e.type===input.type&&e.status!=='rejected'))throw new Error('This relationship already exists');
  const now=new Date().toISOString();
  const edge:GraphEdge={id:randomUUID(),...input,status:'proposed',createdAt:now};
  return {id:randomUUID(),type:'edge_proposed',edge,at:now,epoch:run.graphEpoch};
}

export function reviewEdge(run:Run,id:string,status:'confirmed'|'rejected'):GraphEvent {
  const graph=buildGraph(run);const edge=graph.edges.find(e=>e.id===id);
  if(!edge)throw new Error('Relationship not found in selected scope');
  if(edge.status!=='proposed')throw new Error('Relationship has already been reviewed');
  if(status==='confirmed'&&edge.type!=='contradicts') {
    const adjacency=new Map<string,string[]>();
    for(const e of graph.edges.filter(e=>e.status==='confirmed'&&e.type!=='contradicts')) adjacency.set(e.fromId,[...(adjacency.get(e.fromId)||[]),e.toId]);
    const stack=[edge.toId],seen=new Set<string>();
    while(stack.length){const current=stack.pop()!;if(current===edge.fromId)throw new Error('Confirming this causal relationship would create a cycle');if(seen.has(current))continue;seen.add(current);stack.push(...(adjacency.get(current)||[]));}
  }
  return {id:randomUUID(),type:status==='confirmed'?'edge_confirmed':'edge_rejected',edge:{...edge,status},at:new Date().toISOString(),epoch:run.graphEpoch};
}
