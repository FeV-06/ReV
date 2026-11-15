import { randomUUID } from 'node:crypto';
import type { Artifact, Item, Run } from '@/lib/contracts';
import { attachVerifiedCitations } from './citations';

const repository = 'FeV-06/ReV';
const layaReference = {
  sha: '4bc82544bd808f77abf3c2f170367c5d9807c44b', timestamp: '2026-11-15T08:36:04Z', author: 'kingsahil', file: 'README.md',
  quote: 'Laya checks selected local Git and GitHub commits for changes a successor needs to know about. It uses commit messages, changed paths, selected AST or patch evidence, and the takeover scope when available. It can skip routine edits such as formatting and generated-file churn. ReV keeps the original source records available for review.',
  category: 'decision', text: 'ReV uses Laya to keep routine edits out of the draft so the successor can focus on changes they need to know about. The original evidence stays available for review.',
} as const;
const snapshot = [
  {
    sha: 'cab36751d8f314e29e06e8a784db52dc7563cafb', timestamp: '2026-11-09T18:32:54Z', author: 'FeV06',
    quote: 'checkpoint: wire full handover commands in extension and verify vscode e2e flow',
    category: 'next_action', text: 'Run the VS Code handover flow on your machine and check that you can create, review, approve, and export a draft.',
  },
  {
    sha: '71cb34fbf0eb12f552181472bd0b47f30b5943f8', timestamp: '2026-11-09T17:10:48Z', author: 'FeV06',
    quote: 'checkpoint: implement tree-sitter ast symbol extraction and diff mapping in rev-core',
    category: 'dependency', text: 'ReV uses Tree-sitter in its Rust core to identify changed code symbols and map them to Git diffs.',
  },
  {
    sha: '8f2b0ff861bdf58547c10e4949c004c6e8506baf', timestamp: '2026-11-15T08:47:27Z', author: 'kingsahil',
    quote: 'Keep live GitHub smoke testing opt-in so API rate limits do not determine the default result.',
    category: 'decision', text: 'Live GitHub smoke testing is opt-in so routine checks can run without depending on GitHub API limits.',
  },
  {
    sha: 'b6bc9a84e3e422ac7132ba75155ca33ca373fa23', timestamp: '2026-11-10T02:31:37Z', author: 'FeV06',
    quote: 'checkpoint: fix csp webview clicks, workspace data leak, and raise generation payload budget to 4mb',
    category: 'risk', text: 'When changing the VS Code webview, recheck workspace data isolation. This commit records a fix for an earlier leak.',
  },
  layaReference,
] as const;

export const publicLayaAnswer = {
  answer: layaReference.text,
  citations: [{
    sourceId: layaReference.sha, label: 'Public ReV README', quote: layaReference.quote,
    author: layaReference.author, timestamp: layaReference.timestamp,
    url: `https://github.com/${repository}/blob/${layaReference.sha}/${layaReference.file}`,
  }],
  followUp: null,
};

export function revDemoSources(): Artifact[] {
  return snapshot.map(entry => {
    const { sha, timestamp, author, quote } = entry;
    const file = 'file' in entry ? entry.file : undefined;
    return {
      id: randomUUID(), kind: file ? 'git_document' : 'github_commit', externalId: sha, text: quote, author,
      timestamp, sourceRef: `${repository}@${sha}${file ? ` ${file}` : ''}`,
      url: `https://github.com/${repository}/${file ? `blob/${sha}/${file}` : `commit/${sha}`}`,
    };
  });
}

export function isRevDemo(run: Pick<Run, 'mode' | 'artifacts'>) {
  return run.mode === 'fixture' && run.artifacts.some(source => snapshot.some(entry =>
    source.externalId === entry.sha && source.sourceRef === `${repository}@${entry.sha}`));
}

export function buildRevDemoDraft(run: Run, sources: Artifact[]): Item[] {
  return sources.flatMap(source => {
    const entry = snapshot.find(candidate => candidate.sha === source.externalId && candidate.quote === source.text);
    if (!entry) return [];
    const item: Item = {
      id: randomUUID(), category: entry.category, text: entry.text, citations: [],
      verification: 'unverified', excluded: false, needsClarification: false,
    };
    const verified = attachVerifiedCitations({ ...run, items: [item] }, item.id, [{ sourceId: source.id, quote: entry.quote }]);
    return [{ ...verified, needsClarification: false }];
  });
}
