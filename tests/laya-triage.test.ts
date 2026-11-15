import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Artifact } from '@/lib/contracts';
import { triageDraftSources } from '@/lib/server/laya-triage';

const classify = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: classify }));

function commit(text: string, paths = ['README.md']): Artifact {
  const id = randomUUID();
  return { id, kind: 'git_commit', externalId: id, text, paths, author: null, timestamp: null, url: null, sourceRef: id };
}

function reply(value: unknown) {
  const end = vi.fn();
  classify.mockImplementation((_python, _args, _options, callback) => {
    callback(null, JSON.stringify(value));
    return { stdin: { on: vi.fn(), end } };
  });
  return end;
}

const omit = { choice: 'cosmetic', confidence: 0.99, truncated: false };
const retain = { ...omit, choice: 'retain' };

describe('Laya draft triage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    classify.mockReset();
  });

  it('classifies local and GitHub commits and keeps important changes even on a wrong omit verdict', async () => {
    vi.stubEnv('REV_LAYA_PYTHON', 'python');
    const copyEdit = commit('fix typo in docs');
    const formatting = { ...commit('style: format code'), kind: 'github_commit' as const, paths: undefined };
    const change = commit('Change the default permission to deny access', ['src/auth.ts']);
    const dependency = commit('chore(deps): routine dev dependency bump', ['package.json']);
    const fix = commit('fix: repair task routing', ['src/router.ts']);
    const patch = { ...commit('@@\n-  start( )\n+  start()', []), kind: 'github_commit_patch' as const,
      externalId: `${formatting.externalId}:src/index.ts` };
    const slack = { ...commit('The release owner is Ravi'), kind: 'slack_message' as const };
    const selected = [copyEdit, formatting, change, dependency, fix, patch, slack];
    const end = reply([{ ...omit, confidence: 0.82 }, { ...omit, confidence: 0.83 }, omit, omit, { ...omit, confidence: 0.84 }]);

    const result = await triageDraftSources(selected, 'Runtime and developer tooling');

    expect(result.sources).toEqual([change, fix, slack]);
    expect(result.notice).toContain('Skipped 3 of 5');
    expect(result.notice).toContain(formatting.text);
    const summaries = JSON.parse(end.mock.calls[0][0]).map((summary: string) => JSON.parse(summary));
    expect(summaries[1]).toMatchObject({ message: formatting.text, changes: [{ text: patch.text }], takeoverScope: 'Runtime and developer tooling' });
    expect(selected[0]).toBe(copyEdit);
  });

  it.each([
    [{ ...omit, confidence: 0.7 }, retain], [{ ...omit, truncated: true }, retain],
    [{ ...omit, truncated: null }, retain], [retain, retain], [],
  ].map(verdicts => ({ verdicts })))('keeps evidence if the worker abstains or returns incomplete results ($verdicts)', async ({ verdicts }) => {
    vi.stubEnv('REV_LAYA_PYTHON', 'python');
    const sources = [commit('fix typo in docs'), commit('Replace cache')];
    reply(verdicts);
    expect((await triageDraftSources(sources)).sources).toEqual(sources);
  });

  it('keeps the draft input when every source would be omitted', async () => {
    vi.stubEnv('REV_LAYA_PYTHON', 'python');
    const sources = [commit('fix typo in docs')];
    reply([omit]);
    expect((await triageDraftSources(sources)).sources).toEqual(sources);
  });

  it('can skip report-only changes with long patches and keeps a mixed report and code change', async () => {
    vi.stubEnv('REV_LAYA_PYTHON', 'python');
    const report = { ...commit('checkpoint: update technical report pdf with dual-mode deliverables'), kind: 'github_commit' as const, paths: undefined };
    const patch = { ...commit('report content and architecture decisions '.repeat(500)), kind: 'github_commit_patch' as const,
      paths: undefined, externalId: `${report.externalId}:docs/ROUND2_TECHNICAL_REPORT.html` };
    const mixed = commit('Update technical report and extend the launcher', ['docs/ROUND2_TECHNICAL_REPORT.html', 'src/launch.ts']);
    const initial = [report, patch, mixed];
    const end = reply([{ ...omit, confidence: 0.72 }, { ...omit, confidence: 0.72 }]);
    const result = await triageDraftSources(initial);
    expect(result.sources).toEqual([mixed]);
    expect(result.notice).toContain(report.text);
    expect(end.mock.calls[0][0]).not.toContain(patch.text);
  });

  it('leaves triage disabled without an explicit Python path', async () => {
    vi.stubEnv('REV_LAYA_PYTHON', '');
    const sources = [commit('fix typo in docs')];
    expect(await triageDraftSources(sources)).toEqual({ sources });
    expect(classify).not.toHaveBeenCalled();
  });
});
