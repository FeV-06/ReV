import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { artifactSchema, draftSchema, importSchema, itemSchema, graphEdgeTypeSchema, githubUsernameSchema, targetRoleSchema, type Artifact, type Item, type Run } from '@/lib/contracts';
import { callCore } from '@/lib/server/core';
import { appendEdge, buildGraph, reviewEdge, suggestEvidenceEdges } from '@/lib/server/graph';
import { detectGaps } from '@/lib/server/gaps';
import { attachVerifiedCitations } from '@/lib/server/citations';
import { applyRefresh } from '@/lib/server/refresh';
import { approveRun, compareAndUpdate, createRun, deleteRun, getRun, getVersionedRun, listRuns } from '@/lib/server/store';

import { dayOneItems, generationFailurePrefix, sourceWarnings } from '@/lib/handover';
import { slackChannelId } from '@/lib/server/slack';
import { importLocalGit, importSlackChannels } from '@/lib/server/sources';

const idSchema = z.string().uuid();
const createSchema = z.object({
  recipient: z.string().trim().min(1).max(120).default('Incoming engineer'),
  githubUsername: githubUsernameSchema.optional(),
  targetRole: targetRoleSchema.optional(),
  departingPerson: z.string().trim().min(1).max(120).optional(),
  repo: z.string().max(201).optional(),
  zipBase64: z.string().max(14_000_000).optional(),
  fixture: z.boolean().default(false),
  localGit: z.boolean().default(false),
  connectedSlack: z.boolean().default(false),
  slackChannelIds: z.array(slackChannelId).max(5).default([]),
});
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('scope'), selectedIds: z.array(idSchema).max(500) }),
  z.object({ action: z.literal('generate'), takeoverScope: z.string().trim().max(400).optional(), selectedIds: z.array(idSchema).min(1).max(500), acceptPartial: z.boolean(), confirmAuthorisation: z.literal(true), confirmRemote: z.boolean().default(false), fixture: z.boolean().default(false) }),
  z.object({ action: z.literal('save'), items: z.array(itemSchema).max(100) }),
  z.object({ action: z.literal('graph_propose'), fromId:idSchema, toId:idSchema, type:graphEdgeTypeSchema, evidenceSourceIds:z.array(idSchema).min(1).max(50) }),
  z.object({ action: z.literal('graph_review'), edgeId:idSchema, decision:z.enum(['confirmed','rejected']) }),
  z.object({ action: z.literal('detect_gaps') }),
  z.object({ action: z.literal('detect_divergence'), selectedIds:z.array(idSchema).min(2).max(500),confirmRemote:z.literal(true) }),
  z.object({ action: z.literal('attach_citations'), itemId:idSchema, selectedIds:z.array(idSchema).min(1).max(500), references:z.array(z.object({sourceId:idSchema,quote:z.string().min(1).max(4000)})).min(1).max(10) }),
  z.object({ action: z.literal('redact_source'), sourceId:idSchema, quote:z.string().min(1).max(4000), selectedIds:z.array(idSchema).min(1).max(500) }),
  z.object({ action: z.literal('answer_gap'), gapId:idSchema, answer:z.string().trim().min(1).max(4000), selectedIds:z.array(idSchema).min(1).max(500) }),
  z.object({ action: z.literal('approve'), confirmAuthorisation: z.literal(true) }),
]);

function safeText(s: string): string { return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1'); }
function safeLink(url: string | null): string | null {
  if (!url) return null;
  try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'github.com' ? u.toString() : null; } catch { return null; }
}
export function exportMarkdown(run: Run): string {
  if (run.state !== 'approved' || run.approvedRevision !== run.revision) throw new Error('Approve this revision before export');
  const selected = new Set(run.selectedIds);
  for (const item of run.items.filter(i => !i.excluded)) {
    if (!item.derivationSourceIds?.length || item.derivationSourceIds.some(id => !selected.has(id))) throw new Error('Item provenance is missing or outside the authorised scope; regenerate the draft');
  }
  const sources = new Map(run.artifacts.filter(s => selected.has(s.id)).map(s => [s.id, s]));
  const lines = [`# Handover for ${safeText(run.recipient)}`, '', `Created: ${run.createdAt}`, `Mode: ${run.mode === 'fixture' ? 'synthetic fixture (not model inference)' : 'model-generated, human-reviewed'}`];
  const person = run.departingPerson || run.githubUsername;
  if (person) lines.push(`Contributor: ${safeText(person)}`);
  if (run.targetRole) lines.push(`Target role: ${safeText(run.targetRole)}`);
  if (run.takeoverScope) lines.push(`Takeover scope: ${safeText(run.takeoverScope)}`);
  lines.push('', '## Coverage and limitations', '');
  if (sourceWarnings(run.warnings).length) lines.push('- Source coverage is incomplete; review import warnings in the workspace.'); else lines.push('- No import warnings reported.');
  lines.push('- Source references are validated; semantic accuracy requires human review.', '- Recipient permissions were manually confirmed by the operator.', '');
  const shown = run.items.filter(i => !i.excluded);
  if (!shown.length) lines.push('No items were approved for inclusion.');
  const dayOne = dayOneItems(run);
  const remainder = shown.filter(item => !dayOne.includes(item));
  if (run.departingPerson && !dayOne.length) {
    lines.push('## Start here', '', 'No supported first task yet. Confirm the next step with the team.', '');
  }
  for (const item of [...dayOne, ...remainder]) {
    if (item === dayOne[0]) lines.push('## Start here', '');
    if (item === dayOne[1]) lines.push('## Day 1 follow-ups', '');
    if (dayOne.length && item === remainder[0]) lines.push('## Handover details', '');
    lines.push(`### ${safeText(item.category.replaceAll('_', ' '))}`, '', safeText(item.text), '', `Status: ${item.verification}${item.needsClarification ? ' · clarification needed' : ''}`, '');
    for (const cite of item.verification === 'unverified' ? [] : item.citations) {
      const source = sources.get(cite.sourceId); if (!source) throw new Error('Citation is outside the authorised scope');
      const link = safeLink(source.url); lines.push(`- Source: ${safeText(source.sourceRef)}${link ? ` (${link})` : ''}`, `  - Excerpt: ${safeText(cite.quote)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
export { assertLocalRequest, clientError } from '@/lib/server/request-security';
export async function newRun(raw: unknown): Promise<Run> {
  const args = createSchema.parse(raw);
  const departingPerson = args.departingPerson || args.githubUsername;
  const githubUsername = args.githubUsername || (args.departingPerson && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(args.departingPerson) ? args.departingPerson : undefined);
  const run: Run = {
    id: randomUUID(),
    recipient: args.recipient,
    githubUsername,
    targetRole: args.targetRole,
    departingPerson,
    createdAt: new Date().toISOString(),
    state: 'importing',
    artifacts: [],
    warnings: [],
    selectedIds: [],
    items: [],
    mode: null,
    revision: 0,
    approvedRevision: null,
    acceptedPartial: false,
  };
  if (!args.fixture && !args.repo && !args.zipBase64 && !args.localGit && !args.connectedSlack && !args.slackChannelIds.length) {
    throw new Error('Choose a connected source, GitHub repository or Slack export');
  }
  await createRun(run);
  const imports: {label: string; load: () => Promise<unknown>}[] = [];
  if (args.fixture) {
    const github = JSON.parse(await readFile(path.join(process.cwd(), 'fixtures/github.json'), 'utf8'));
    const zip = await readFile(path.join(process.cwd(), 'fixtures/slack-fixture.zip'));
    imports.push({ label: 'Synthetic GitHub', load: () => callCore({ op:'normalize_fixture', ...github }) }, { label:'Synthetic Slack', load: () => callCore({ op:'slack', zipBase64:zip.toString('base64') }) });
    run.mode = 'fixture';
  } else {
    if (args.localGit) imports.push({label:'Local Git', load: importLocalGit});
    if (args.repo) imports.push({label:'GitHub', load: () => callCore({op:'github', repo:args.repo, contributor:githubUsername})});
    if (args.connectedSlack || args.slackChannelIds.length) imports.push({label:'Connected Slack', load: () => importSlackChannels(args.slackChannelIds)});
    if (args.zipBase64) imports.push({label:'Slack', load: () => callCore({op:'slack', zipBase64:args.zipBase64})});
  }
  for (const {label,load} of imports) {
    try { const result = importSchema.parse(await load()); run.artifacts.push(...result.artifacts); run.warnings.push(...result.warnings.map(w => `${label}: ${w}`)); }
    catch (error) { run.warnings.push(`${label}: ${error instanceof Error ? error.message : 'Import failed'}`); }
  }
  run.state = run.artifacts.length ? 'awaiting_scope_confirmation' : 'failed';
  await compareAndUpdate(run, 0);
  return run;
}
export async function updateAction(id: string, raw: unknown): Promise<Run> {
  idSchema.parse(id); const stored = await getVersionedRun(id); if (!stored) throw new Error('Run not found');
  const {run} = stored; let version = stored.version;
  const args = actionSchema.parse(raw);
  if (args.action === 'scope') {
    if (['importing','reconstructing'].includes(run.state)) throw new Error('Cannot change scope while the run is processing');
    const validIds = new Set(run.artifacts.map(a => a.id));
    if (args.selectedIds.some(id => !validIds.has(id)) || args.selectedIds.length !== new Set(args.selectedIds).size) throw new Error('Invalid source selection');
    const changed = [...args.selectedIds].sort().join(',') !== [...run.selectedIds].sort().join(',');
    if (changed) {
      run.selectedIds = args.selectedIds; run.items = []; run.graphEpoch = randomUUID(); run.approvedRevision = null; run.revision++; run.state = 'awaiting_scope_confirmation';
      await compareAndUpdate(run, version);
    }
    return publicRun(run);
  } else if (args.action === 'generate') {
    if (!['awaiting_scope_confirmation','needs_review','approved','failed'].includes(run.state)) throw new Error('Run is already processing');
    const coverageWarnings = sourceWarnings(run.warnings);
    if (coverageWarnings.length && !args.acceptPartial) throw new Error('Acknowledge incomplete source coverage before continuing');
    if (args.fixture !== (run.mode === 'fixture')) throw new Error('Fixture mode is available only for the synthetic example');
    const validIds = new Set(run.artifacts.map(a => a.id));
    if (args.selectedIds.some(id => !validIds.has(id))) throw new Error('Selected source is not in this run');
    if (args.selectedIds.length !== new Set(args.selectedIds).size) throw new Error('Duplicate source selection');
    if (!args.fixture && !args.confirmRemote) throw new Error('Confirm the selected material may be sent to the configured provider');
    if (args.selectedIds.slice().sort().join(',') !== run.selectedIds.slice().sort().join(',')) throw new Error('Source scope changed; save it before generation');
    const takeoverScope = (args.takeoverScope ?? run.takeoverScope) || undefined;
    run.takeoverScope = takeoverScope;
    run.warnings = coverageWarnings;
    run.items = []; run.graphEpoch = randomUUID(); run.approvedRevision = null; run.revision++; run.state = 'reconstructing'; run.acceptedPartial = args.acceptPartial; version = await compareAndUpdate(run, version);
    try {
      const sources = run.artifacts.filter(a => args.selectedIds.includes(a.id)).map(a => artifactSchema.parse(a));
      const handoverContext = {
        githubUsername: run.githubUsername,
        targetRole: run.targetRole,
        departingPerson: run.departingPerson,
        takeoverScope,
        incomingRole: run.recipient,
      };
      const result = draftSchema.parse(await callCore({
        op: args.fixture ? 'fixture_generate' : 'generate',
        sources,
        handover: (run.departingPerson || run.githubUsername || takeoverScope) ? handoverContext : undefined,
        context: handoverContext,
      }));
      run.items = result.items.map(item => ({...item, derivationSourceIds: [...run.selectedIds]})); run.mode = args.fixture ? 'fixture' : 'model'; run.state = 'needs_review';
      run.graphEvents=[...(run.graphEvents||[]),...suggestEvidenceEdges(run)];
    } catch (error) { run.state = 'failed'; run.warnings.push(`${generationFailurePrefix}${error instanceof Error ? error.message : 'Unknown error'}`); await compareAndUpdate(run, version); throw error; }
  } else if (args.action === 'save') {
    if (!['needs_review','approved'].includes(run.state)) throw new Error('Generate a draft before reviewing');
    if (args.items.length !== run.items.length || new Set(args.items.map(i => i.id)).size !== run.items.length) throw new Error('Review must contain every draft item exactly once');
    const original = new Map(run.items.map(i => [i.id, i]));
    const semanticChanged = args.items.some(i=>{const old=original.get(i.id);return !old||i.text!==old.text||i.excluded!==old.excluded;});
    run.items = args.items.map(i => {
      const old = original.get(i.id); if (!old) throw new Error('Unknown item');
      const changed = i.text !== old.text;
      return {...old, text:i.text, excluded:i.excluded, needsClarification:i.needsClarification, citations: changed ? [] : old.citations, verification: changed ? 'unverified' : old.verification} as Item;
    });
    if(semanticChanged) run.graphEpoch=randomUUID();
    run.state = 'needs_review'; run.revision++; run.approvedRevision = null;
  } else if (args.action === 'graph_propose' || args.action === 'graph_review') {
    if (!['needs_review','approved'].includes(run.state)) throw new Error('Generate a draft before editing relationships');
    const event=args.action==='graph_propose'?appendEdge(run,{fromId:args.fromId,toId:args.toId,type:args.type,evidenceSourceIds:args.evidenceSourceIds}):reviewEdge(run,args.edgeId,args.decision);
    run.graphEvents=[...(run.graphEvents||[]),event];run.state='needs_review';run.revision++;run.approvedRevision=null;
  } else if (args.action === 'detect_divergence') {
    if(!['needs_review','approved'].includes(run.state))throw new Error('Generate a draft before checking divergence');
    if(args.selectedIds.slice().sort().join(',')!==run.selectedIds.slice().sort().join(','))throw new Error('Source scope changed; reload before checking divergence');
    const sources=run.artifacts.filter(a=>run.selectedIds.includes(a.id)).map(a=>artifactSchema.parse(a));
    const result=draftSchema.parse(await callCore({op:'detect_divergence',sources}));
    if(run.items.length+result.items.length>100)throw new Error('Too many handover items');
    const candidates=result.items.map(item=>({...item,category:'risk' as const,needsClarification:true,derivationSourceIds:[...run.selectedIds]}));
    run.items=[...run.items,...candidates];
    run.graphEvents=[...(run.graphEvents||[]),...suggestEvidenceEdges({...run,items:candidates})];
    run.state='needs_review';run.revision++;run.approvedRevision=null;
  } else if (args.action === 'redact_source') {
    if(!['awaiting_scope_confirmation','needs_review','approved'].includes(run.state))throw new Error('Source redaction is unavailable while the run is processing');
    if(args.selectedIds.slice().sort().join(',')!==run.selectedIds.slice().sort().join(','))throw new Error('Source scope changed; reload before redaction');
    if(!run.selectedIds.includes(args.sourceId))throw new Error('Redaction source is not selected');
    const source=run.artifacts.find(a=>a.id===args.sourceId);
    if(!source||!source.text.includes(args.quote))throw new Error('Exact redaction quote not found');
    const now=new Date().toISOString();const redactedSourceId=randomUUID();
    run.artifacts.push({id:redactedSourceId,kind:'review_redaction',externalId:redactedSourceId,text:source.text.replaceAll(args.quote,'[REDACTED]'),author:null,timestamp:now,url:null,sourceRef:`Reviewer-redacted source ${redactedSourceId}`});
    run.sourceEvents=[...(run.sourceEvents||[]),{id:randomUUID(),type:'source_redacted',parentSourceId:source.id,redactedSourceId,at:now}];
    run.selectedIds=[];run.items=[];run.gaps=[];run.graphEpoch=randomUUID();run.state='awaiting_scope_confirmation';run.revision++;run.approvedRevision=null;
  } else if (args.action === 'attach_citations') {
    if(!['needs_review','approved'].includes(run.state))throw new Error('Generate a draft before reviewing citations');
    if(args.selectedIds.slice().sort().join(',')!==run.selectedIds.slice().sort().join(','))throw new Error('Source scope changed; reload before attaching citations');
    const repaired=attachVerifiedCitations(run,args.itemId,args.references);
    run.items=run.items.map(i=>i.id===args.itemId?repaired:i);run.graphEpoch=randomUUID();
    run.graphEvents=[...(run.graphEvents||[]),...suggestEvidenceEdges(run)];run.state='needs_review';run.revision++;run.approvedRevision=null;
  } else if (args.action === 'detect_gaps') {
    if(!['needs_review','approved'].includes(run.state))throw new Error('Generate a draft before detecting gaps');
    const detected=detectGaps(run);const answered=(run.gaps||[]).filter(g=>g.status==='answered');
    run.gaps=[...answered,...detected];run.state='needs_review';run.revision++;run.approvedRevision=null;
  } else if (args.action === 'answer_gap') {
    if(!['needs_review','approved'].includes(run.state))throw new Error('Generate a draft before answering gaps');
    const gap=(run.gaps||[]).find(g=>g.id===args.gapId&&g.status==='open');
    if(!gap||!run.items.some(i=>i.id===gap.itemId&&!i.excluded))throw new Error('Open gap not found');
    if(args.selectedIds.slice().sort().join(',')!==run.selectedIds.slice().sort().join(','))throw new Error('Source scope changed; reload before answering');
    const now=new Date().toISOString();const sourceId=randomUUID();
    run.artifacts.push({id:sourceId,kind:'review_answer',externalId:sourceId,text:args.answer,author:'Reviewer',timestamp:now,url:null,sourceRef:`Reviewer answer ${sourceId}`});
    run.gaps=(run.gaps||[]).map(g=>g.id===gap.id?{...g,status:'answered',answerSourceId:sourceId}:g);
    run.selectedIds=[];run.items=[];run.graphEpoch=randomUUID();run.state='awaiting_scope_confirmation';run.revision++;run.approvedRevision=null;
  } else {
    if (run.state !== 'needs_review') throw new Error('Only a reviewed draft can be approved');
    run.state = 'approved'; run.approvedRevision = run.revision;
    await approveRun(run, version); return publicRun(run);
  }
  await compareAndUpdate(run, version); return publicRun(run);
}
async function readRawRun(id:string):Promise<Run> { idSchema.parse(id); const run=await getRun(id); if(!run) throw new Error('Run not found'); return run; }
function publicRun(run:Run):Run {
  const visibleIds=new Set(run.items.filter(i=>!i.excluded).map(i=>i.id));const scope=new Set(run.selectedIds);
  return {...run,graphEvents:(run.graphEvents||[]).filter(e=>(!run.graphEpoch||e.epoch===run.graphEpoch)&&e.edge.evidenceSourceIds.every(id=>scope.has(id))),gaps:(run.gaps||[]).filter(g=>visibleIds.has(g.itemId)&&g.sourceIds.every(id=>scope.has(id)))};
}
export async function readRun(id: string): Promise<Run> { return publicRun(await readRawRun(id)); }
export async function readGraph(id: string) { return buildGraph(await readRawRun(id)); }
export async function refreshRun(id:string,raw:unknown):Promise<Run>{
  const args=z.object({sources:z.array(artifactSchema).max(1000),revokedIds:z.array(idSchema).max(1000),expectedRevision:z.number().int().nonnegative()}).parse(raw);
  const prior=await readRawRun(id);if(prior.revision!==args.expectedRevision)throw new Error('Run changed; reload before refreshing');
  const next=applyRefresh(prior,args.sources,args.revokedIds);await createRun(next);return publicRun(next);
}
export { listRuns, deleteRun };
