import { randomUUID } from 'node:crypto';
import { draftSchema, type Artifact, type Gap, type Run } from '@/lib/contracts';
import { callCore } from '@/lib/server/core';

export function visibleGaps(run: Run): Gap[] {
  const selected = new Set(run.selectedIds);
  return (run.gaps ?? []).filter(gap =>
    (!gap.itemId || run.items.some(item => item.id === gap.itemId && !item.excluded))
    && gap.sourceIds.every(id => selected.has(id)),
  );
}

const normalize = (text: string) => text.toLowerCase().replace(/[\p{P}\s]+/gu, ' ').trim();
const stopWords = new Set('what when where which why how the and for with from does did can could should would was are who about this that'.split(' '));
function keywords(text: string) {
  return [...new Set(normalize(text).split(' ').filter(word => word.length > 2 && !stopWords.has(word)))];
}

function sourcesFor(run: Run, query: string, forInterview = false) {
  const selected = new Set(run.selectedIds);
  const terms = keywords(query);
  const answers = new Map(visibleGaps(run).map(gap => [gap.answerSourceId, gap]));
  const ranked = run.artifacts.filter(source => selected.has(source.id)).map(source => {
    const gap = answers.get(source.id);
    const searchable = normalize([source.sourceRef, gap?.question, source.text].join(' '));
    const score = terms.filter(term => searchable.includes(term)).length
      + (gap && normalize(gap.question) === normalize(query) ? 100 : 0);
    return { source, score };
  }).sort((a, b) => b.score - a.score);
  if (forInterview) {
    const slack = ranked.find(({ source }) => source.kind === 'slack_message');
    const docs = ranked.filter(({ source }) => source.kind === 'git_document');
    const git = ranked.find(({ source }) => source.kind === 'git_commit' || source.kind === 'github_commit');
    const first = [...docs, git, slack].filter(entry => entry !== undefined);
    ranked.splice(0, ranked.length, ...first, ...ranked.filter(entry => !first.includes(entry)));
  }
  const sources: Artifact[] = [];
  let remainingBytes = 75_000;
  for (const { source } of ranked) {
    const excerpt = { ...source, text: source.text.slice(0, 5000).replace(/[\uD800-\uDBFF]$/, '') };
    const bytes = Buffer.byteLength(JSON.stringify(excerpt)) + 1;
    if (bytes > remainingBytes) continue;
    sources.push(excerpt);
    remainingBytes -= bytes;
    if (sources.length === (forInterview ? 70 : 20)) break;
  }
  return sources;
}

export async function prepareInterview(run: Run) {
  const sources = sourcesFor(run, run.takeoverScope ?? '', true);
  const result = draftSchema.parse(await callCore({
    op: 'prepare_interview', sources,
    context: {
      departingPerson: run.departingPerson ?? run.githubUsername,
      takeoverScope: run.takeoverScope, targetRole: run.targetRole,
      existingQuestions: visibleGaps(run).slice(0, 12).map(gap => gap.question.slice(0, 300)),
    },
  }));
  return result.items.filter(item => item.category === 'unknown' && item.citations.length > 0).slice(0, 6).map(item => ({
    id: randomUUID(), origin: 'interview' as const, question: item.text,
    sourceIds: [...new Set(item.citations.map(cite => cite.sourceId))], status: 'open' as const,
  }));
}

export function appendQuestions(run: Run, proposed: Gap[]) {
  const queue = run.gaps ??= [];
  const existing = new Set(visibleGaps(run).map(gap => normalize(gap.question)));
  for (const gap of proposed) {
    const key = normalize(gap.question);
    if (!key || existing.has(key)) continue;
    if (queue.length >= 100) throw new Error('This handover has reached its question limit');
    queue.push(gap);
    existing.add(key);
  }
}

export async function answerSuccessor(run: Run, question: string) {
  const sources = sourcesFor(run, question);
  const approvedAnswers = visibleGaps(run).filter(gap => sources.some(source => source.id === gap.answerSourceId));
  const exact = approvedAnswers.find(gap => normalize(gap.question) === normalize(question));
  const direct = sources.find(source => source.id === exact?.answerSourceId);

  const cite = (source: Artifact, quote: string) => ({
    sourceId: source.id, label: source.sourceRef, quote, author: source.author, timestamp: source.timestamp,
    url: source.url?.startsWith('https://') ? source.url : null,
  });
  if (direct) return { answer: direct.text, citations: [cite(direct, direct.text)], followUp: null };

  if (!sources.length) return { answer: null, citations: [], followUp: question };

  if (run.mode === 'fixture') {
    const terms = keywords(question);
    const match = terms.length >= 2 && sources.find(source =>
      terms.every(term => normalize(source.text).includes(term)));
    return match
      ? { answer: match.text, citations: [cite(match, match.text)], followUp: null }
      : { answer: null, citations: [], followUp: question };
  }

  const result = draftSchema.parse(await callCore({
    op: 'answer_successor', sources,
    context: { question, interviewAnswers: approvedAnswers.slice(0, 12).map(gap => ({
      sourceId: gap.answerSourceId, question: gap.question.slice(0, 300),
    })) },
  }));
  const supported = result.items.find(item => item.category === 'next_action' && item.citations.length);
  const missing = result.items.find(item => item.category === 'unknown');
  return {
    answer: supported?.text ?? null,
    citations: (supported?.citations ?? []).flatMap(reference => {
      const source = sources.find(source => source.id === reference.sourceId);
      return source && reference.quote.trim() && source.text.includes(reference.quote)
        ? [cite(source, reference.quote)] : [];
    }),
    followUp: missing?.text ?? (supported ? null : question),
  };
}
