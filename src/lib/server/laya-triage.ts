import { execFile } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import type { Artifact } from '@/lib/contracts';
import type { TriageStats } from '@/lib/generation-progress';

const verdictsSchema = z.array(z.object({
  choice: z.enum(['cosmetic', 'retain']),
  confidence: z.number().min(0).max(1).nullish(),
  truncated: z.boolean().nullish(),
}));

export const importantTerms = /\b(?:security|cve|vulnerabilit(?:y|ies)|auth|authentication|authorization|passwords?|tokens?|permissions?|credentials?|secrets?|encrypt(?:ion|ed)?|access[ -]control|privileges?|bypass|breaking|migrations?|rollback|deploy(?:ment)?|runbooks?|recovery|incidents?|schemas?|risks?|todo|follow.up|fixme|adr|rfc|decisions?|regressions?|data loss|race condition)\b/i;
const routineChange = /\b(?:typos?|spelling|punctuation|format(?:ting)?|prettier|whitespace|regenerate|generated files?|cosmetic|icon spacing|no (?:logic|behavior|source) changes|dev dependency bump)\b/i;

function changedPath(source: Artifact) {
  if (source.paths?.length === 1) return source.paths[0];
  if (source.kind === 'github_commit_patch') return source.externalId.split(/:(.*)/s, 2)[1];
}

function commitKey(source: Artifact) {
  const sha = source.externalId.split(':', 1)[0];
  if (source.kind === 'git_commit' || source.kind === 'code_symbol') return `local:${sha.slice(0, 7)}`;
  if (source.kind === 'github_commit' || source.kind === 'github_commit_patch') return `github:${sha}`;
}

function classify(python: string, summaries: string[]) {
  return new Promise<z.infer<typeof verdictsSchema>>((resolve, reject) => {
    const script = path.join(process.cwd(), 'scripts', 'laya-triage.py');
    const child = execFile(python, [script], {
      timeout: 45_000,
      maxBuffer: 256_000,
      env: { ...process.env, HF_HUB_OFFLINE: '1' },
      windowsHide: true,
    }, (error, stdout) => {
      if (error) return reject(error);
      try {
        const verdicts = verdictsSchema.parse(JSON.parse(stdout));
        if (verdicts.length !== summaries.length) throw new Error('Incomplete Laya response');
        resolve(verdicts);
      } catch (parseError) {
        reject(parseError);
      }
    });
    child.stdin?.on('error', reject);
    child.stdin?.end(JSON.stringify(summaries));
  });
}

export async function triageDraftSources(sources: Artifact[], takeoverScope?: string) {
  const python = process.env.REV_LAYA_PYTHON?.trim();
  const commits = sources.filter(source => source.kind === 'git_commit' || source.kind === 'github_commit');
  const stats = (status: TriageStats['status'], evaluated = 0, skipped = 0): TriageStats => ({
    status, evaluated, skipped, retained: commits.length - skipped, unevaluated: commits.length - evaluated,
  });
  const counts = (result: TriageStats) => `Evaluated ${result.evaluated} commits; retained ${result.retained}, skipped ${result.skipped}, not evaluated ${result.unevaluated}.`;
  if (!python) {
    const result = stats('disabled');
    return { sources, stats: result, notice: `Laya is not configured; all selected sources were retained. ${counts(result)}` };
  }

  const related = new Map<string, Artifact[]>();
  for (const source of sources) {
    const key = commitKey(source);
    if (!key || (source.kind !== 'code_symbol' && source.kind !== 'github_commit_patch')) continue;
    const siblings = related.get(key) ?? [];
    siblings.push(source);
    related.set(key, siblings);
  }

  const candidates = commits.flatMap(source => {
    const evidence = related.get(commitKey(source)!) ?? [];
    const evidencePaths = evidence.map(changedPath);
    const paths = [...new Set([...(source.paths ?? []), ...evidencePaths.filter((file): file is string => Boolean(file))])];
    const summary = JSON.stringify({
      message: source.text.trim(),
      paths,
      changes: evidence.map(change => ({ ref: change.sourceRef, text: change.text })),
      takeoverScope,
    });
    // Large changes stay in synthesis when the classifier cannot see the full evidence.
    if (!source.text.trim() || summary.length > 6_000 || source.paths?.length === 100) return [];
    // A symbol contains a signature, not a complete behavioural diff. Never drop
    // selected symbols (or their parent) on an uncertain cosmetic verdict.
    const protectedChange = evidence.some(change => change.kind === 'code_symbol') ||
      // Messages and path names alone do not establish that code or dependency
      // changes are cosmetic. A selected patch must cover every changed path.
      !paths.length || paths.some(file => !/\.(?:md|txt)$/i.test(file) &&
        !evidence.some(change => change.kind === 'github_commit_patch' && changedPath(change) === file)) ||
      importantTerms.test([
      source.text, ...paths, ...evidence.flatMap(change => [change.sourceRef, change.text]),
    ].join('\n'));
    const threshold = routineChange.test(source.text) ? 0.75 : 0.95;
    return [{ source, evidence, summary, protectedChange, threshold }];
  });
  if (!candidates.length) {
    const result = stats('no_candidates');
    return { sources, stats: result, notice: `No selected commits could be classified; all sources were retained. ${counts(result)}` };
  }

  try {
    const verdicts = await classify(python, candidates.map(candidate => candidate.summary));
    const omitted = candidates.filter((candidate, index) => {
      const verdict = verdicts[index];
      return !candidate.protectedChange && verdict.choice === 'cosmetic' && verdict.truncated === false &&
        (verdict.confidence ?? 0) >= candidate.threshold;
    });
    const omittedCommits = new Set(omitted.map(({ source }) => source.id));
    const retainedKeys = new Set(sources.filter(source =>
      (source.kind === 'git_commit' || source.kind === 'github_commit') && !omittedCommits.has(source.id)
    ).map(commitKey));
    const omittedIds = new Set(omitted.flatMap(({ source, evidence }) => [source.id,
      ...(retainedKeys.has(commitKey(source)) ? [] : evidence.map(change => change.id))]));
    if (omittedIds.size === sources.length) {
      const result = stats('available', candidates.length);
      return { sources, stats: result, notice: `Kept all selected evidence so the draft would have sources. ${counts(result)}` };
    }
    const result = stats('available', candidates.length, omitted.length);
    const examples = omitted.slice(0, 5).map(({ source }) => `${source.sourceRef.slice(0, 120)}: “${source.text.trim().split(/\r?\n/, 1)[0].slice(0, 120)}”`);
    const summary = examples.length ? ` Skipped commits include ${examples.join(', ')}.` : '';
    return {
      sources: sources.filter(source => !omittedIds.has(source.id)),
      stats: result,
      notice: `${counts(result)} Original selected sources remain available for review.${summary}`,
    };
  } catch {
    const result = stats('unavailable');
    return { sources, stats: result, notice: `Classification unavailable. Draft generation retained all selected sources. ${counts(result)}` };
  }
}
