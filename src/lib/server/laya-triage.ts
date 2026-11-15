import { execFile } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import type { Artifact } from '@/lib/contracts';

const verdictsSchema = z.array(z.object({
  choice: z.enum(['cosmetic', 'retain']),
  confidence: z.number().min(0).max(1).nullish(),
  truncated: z.boolean().nullish(),
}));

const importantTerms = /\b(?:security|cve|vulnerability|auth|authentication|authorization|passwords?|tokens?|permissions?|breaking|migrations?|rollback|deploy(?:ment)?|runbooks?|recovery|incidents?|schemas?|risks?|todo|follow.up|fixme|adr|rfc|decisions?|regressions?|data loss|race condition)\b/i;
const routineChange = /\b(?:typos?|spelling|punctuation|format(?:ting)?|prettier|whitespace|regenerate|generated files?|cosmetic|icon spacing|no (?:logic|behavior|source) changes|dev dependency bump)\b/i;
const reportUpdate = /\b(?:technical report|report pdf|submission pdf)\b/i;
const reportFile = /(?:^|\/)(?:[\w.-]*technical[-_ ]report[\w.-]*|[\w.-]*submission[-_ ]report[\w.-]*)\.(?:html|pdf)$/i;

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
  if (!python) return { sources };

  const related = new Map<string, Artifact[]>();
  for (const source of sources) {
    const key = commitKey(source);
    if (!key || (source.kind !== 'code_symbol' && source.kind !== 'github_commit_patch')) continue;
    const siblings = related.get(key) ?? [];
    siblings.push(source);
    related.set(key, siblings);
  }

  const candidates = sources.flatMap(source => {
    if (source.kind !== 'git_commit' && source.kind !== 'github_commit') return [];
    const evidence = related.get(commitKey(source)!) ?? [];
    const evidencePaths = evidence.map(changedPath);
    const paths = [...new Set([...(source.paths ?? []), ...evidencePaths.filter((file): file is string => Boolean(file))])];
    const reportOnly = reportUpdate.test(source.text) && paths.length > 0 && paths.every(file => reportFile.test(file)) &&
      evidence.every(change => change.kind === 'github_commit_patch' && Boolean(changedPath(change)));
    const summary = JSON.stringify({
      message: source.text.trim(),
      paths,
      changes: reportOnly ? undefined : evidence.map(change => ({ ref: change.sourceRef, text: change.text })),
      takeoverScope,
    });
    // Large changes stay in synthesis when the classifier cannot see the full evidence.
    if (!source.text.trim() || summary.length > 6_000 || source.paths?.length === 100) return [];
    const protectedChange = importantTerms.test([source.text, ...paths,
      ...(reportOnly ? [] : evidence.flatMap(change => [change.sourceRef, change.text]))].join('\n'));
    const threshold = reportOnly ? 0.60 : routineChange.test(source.text) ? 0.75 : 0.95;
    return [{ source, evidence, summary, protectedChange, threshold }];
  });
  if (!candidates.length) return { sources, notice: 'Skipped 0 commits. No selected commit summaries could be classified.' };

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
      return { sources, notice: `Skipped 0 of ${candidates.length} evaluated commits. Kept all selected evidence so the draft would have sources.` };
    }
    const examples = omitted.slice(0, 5).map(({ source }) => `“${source.text.trim().split(/\r?\n/, 1)[0].slice(0, 120)}”`);
    const summary = examples.length ? ` Skipped commits include ${examples.join(', ')}.` : '';
    return {
      sources: sources.filter(source => !omittedIds.has(source.id)),
      notice: `Skipped ${omitted.length} of ${candidates.length} evaluated commits from draft generation.${summary}`,
    };
  } catch {
    return { sources, notice: 'Classification unavailable. Draft generation used the selected sources.' };
  }
}
