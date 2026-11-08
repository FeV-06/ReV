import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { artifactSchema, draftSchema, importSchema, itemSchema, type Artifact, type Item, type Run } from '@/lib/contracts';
import { callCore } from '@/lib/server/core';
import { approveRun, compareAndUpdate, createRun, deleteRun, getRun, getVersionedRun, listRuns, updateRun } from '@/lib/server/store';

const idSchema = z.string().uuid();
const createSchema = z.object({ recipient: z.string().trim().min(1).max(120), repo: z.string().max(201).optional(), zipBase64: z.string().max(14_000_000).optional(), fixture: z.boolean().default(false) });
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate'), selectedIds: z.array(idSchema).min(1).max(500), acceptPartial: z.boolean(), confirmAuthorisation: z.literal(true), confirmRemote: z.boolean().default(false), fixture: z.boolean().default(false) }),
  z.object({ action: z.literal('save'), items: z.array(itemSchema).max(100) }),
  z.object({ action: z.literal('approve'), confirmAuthorisation: z.literal(true) }),
]);

function safeText(s: string): string { return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('[', '\\[').replaceAll(']', '\\]'); }
function safeLink(url: string | null): string | null {
  if (!url) return null;
  try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'github.com' ? u.toString() : null; } catch { return null; }
}
export function exportMarkdown(run: Run): string {
  if (run.state !== 'approved' || run.approvedRevision !== run.revision) throw new Error('Approve this revision before export');
  const selected = new Set(run.selectedIds);
  const sources = new Map(run.artifacts.filter(s => selected.has(s.id)).map(s => [s.id, s]));
  const lines = [`# Handover for ${safeText(run.recipient)}`, '', `Created: ${run.createdAt}`, `Mode: ${run.mode === 'fixture' ? 'synthetic fixture (not model inference)' : 'model-generated, human-reviewed'}`, '', '## Coverage and limitations', ''];
  if (run.warnings.length) lines.push(...run.warnings.map(w => `- ${safeText(w)}`)); else lines.push('- No import warnings reported.');
  lines.push('- Source references are validated; semantic accuracy requires human review.', '- Recipient permissions were manually confirmed by the operator.', '');
  const shown = run.items.filter(i => !i.excluded);
  if (!shown.length) lines.push('No items were approved for inclusion.');
  for (const item of shown) {
    lines.push(`### ${safeText(item.category.replaceAll('_', ' '))}`, '', safeText(item.text), '', `Status: ${item.verification}${item.needsClarification ? ' · clarification needed' : ''}`, '');
    for (const cite of item.verification === 'unverified' ? [] : item.citations) {
      const source = sources.get(cite.sourceId); if (!source) throw new Error('Citation is outside the authorised scope');
      const link = safeLink(source.url); lines.push(`- Source: ${safeText(source.sourceRef)}${link ? ` (${link})` : ''}`, `  - Excerpt: ${safeText(cite.quote)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
function getOrigin(request: Request): boolean {
  const origin = request.headers.get('origin'); const host = request.headers.get('host');
  if (!host || !/^(127\.0\.0\.1|localhost):3077$/.test(host)) return false;
  if (origin) return origin === `http://${host}`;
  if (request.method !== 'GET') return false;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
export function assertLocalRequest(request: Request): void {
  if (!getOrigin(request)) throw new Error('Forbidden: open ReV at http://127.0.0.1:3077');
  if (request.headers.get('x-rev-request') !== '1') throw new Error('Forbidden: missing request header');
}
export async function newRun(raw: unknown): Promise<Run> {
  const args = createSchema.parse(raw); const run: Run = { id: randomUUID(), recipient: args.recipient, createdAt: new Date().toISOString(), state: 'importing', artifacts: [], warnings: [], selectedIds: [], items: [], mode: null, revision: 0, approvedRevision: null, acceptedPartial: false };
  if (!args.fixture && !args.repo && !args.zipBase64) throw new Error('Provide a GitHub repository or Slack export');
  await createRun(run);
  const imports: {label:string; op:object}[] = [];
  if (args.fixture) {
    const github = JSON.parse(await readFile(path.join(process.cwd(), 'fixtures/github.json'), 'utf8'));
    const zip = await readFile(path.join(process.cwd(), 'fixtures/slack-fixture.zip'));
    imports.push({ label: 'Synthetic GitHub', op: { op:'normalize_fixture', ...github } }, { label:'Synthetic Slack', op:{ op:'slack', zipBase64:zip.toString('base64') } });
    run.mode = 'fixture';
  } else {
    if (args.repo) imports.push({label:'GitHub', op:{op:'github', repo:args.repo}});
    if (args.zipBase64) imports.push({label:'Slack', op:{op:'slack', zipBase64:args.zipBase64}});
  }
  for (const {label,op} of imports) {
    try { const result = importSchema.parse(await callCore(op)); run.artifacts.push(...result.artifacts); run.warnings.push(...result.warnings.map(w => `${label}: ${w}`)); }
    catch (error) { run.warnings.push(`${label}: ${error instanceof Error ? error.message : 'Import failed'}`); }
  }
  run.state = run.artifacts.length ? 'awaiting_scope_confirmation' : 'failed';
  await updateRun(run);
  return run;
}
export async function updateAction(id: string, raw: unknown): Promise<Run> {
  idSchema.parse(id); const stored = await getVersionedRun(id); if (!stored) throw new Error('Run not found');
  const {run} = stored; let version = stored.version;
  const args = actionSchema.parse(raw);
  if (args.action === 'generate') {
    if (!['awaiting_scope_confirmation','needs_review','approved','failed'].includes(run.state)) throw new Error('Run is already processing');
    if (run.warnings.length && !args.acceptPartial) throw new Error('Acknowledge incomplete source coverage before continuing');
    if (args.fixture !== (run.mode === 'fixture')) throw new Error('Fixture mode is available only for the synthetic example');
    const validIds = new Set(run.artifacts.map(a => a.id));
    if (args.selectedIds.some(id => !validIds.has(id))) throw new Error('Selected source is not in this run');
    if (args.selectedIds.length !== new Set(args.selectedIds).size) throw new Error('Duplicate source selection');
    if (!args.fixture && !args.confirmRemote) throw new Error('Confirm the selected material may be sent to the configured provider');
    run.selectedIds = args.selectedIds; run.items = []; run.approvedRevision = null; run.revision++; run.state = 'reconstructing'; run.acceptedPartial = args.acceptPartial; version = await compareAndUpdate(run, version);
    try {
      const sources = run.artifacts.filter(a => args.selectedIds.includes(a.id)).map(a => artifactSchema.parse(a));
      const result = draftSchema.parse(await callCore({op:args.fixture ? 'fixture_generate' : 'generate', sources}));
      run.items = result.items; run.mode = args.fixture ? 'fixture' : 'model'; run.state = 'needs_review';
    } catch (error) { run.state = 'failed'; await compareAndUpdate(run, version); throw error; }
  } else if (args.action === 'save') {
    if (!['needs_review','approved'].includes(run.state)) throw new Error('Generate a draft before reviewing');
    if (args.items.length !== run.items.length || new Set(args.items.map(i => i.id)).size !== run.items.length) throw new Error('Review must contain every draft item exactly once');
    const original = new Map(run.items.map(i => [i.id, i]));
    run.items = args.items.map(i => {
      const old = original.get(i.id); if (!old) throw new Error('Unknown item');
      const changed = i.text !== old.text;
      return {...old, text:i.text, excluded:i.excluded, needsClarification:i.needsClarification, citations: changed ? [] : old.citations, verification: changed ? 'unverified' : old.verification} as Item;
    });
    run.state = 'needs_review'; run.revision++; run.approvedRevision = null;
  } else {
    if (run.state !== 'needs_review') throw new Error('Only a reviewed draft can be approved');
    run.state = 'approved'; run.approvedRevision = run.revision;
    await approveRun(run, version); return run;
  }
  await compareAndUpdate(run, version); return run;
}
export async function readRun(id: string): Promise<Run> { idSchema.parse(id); const run = await getRun(id); if (!run) throw new Error('Run not found'); return run; }
export { listRuns, deleteRun };
export function clientError(error: unknown): string { return error instanceof z.ZodError ? 'Invalid request data' : error instanceof Error ? error.message : 'Operation failed'; }
