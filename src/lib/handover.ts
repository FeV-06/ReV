import type { Item, Run } from './contracts';

export const generationFailurePrefix = 'Generation failed: ';

export function sourceWarnings(warnings: string[]) {
  return warnings.filter(warning => !warning.startsWith(generationFailurePrefix));
}

export function suggestedAreas(run: Run): string[] {
  const person = run.departingPerson?.toLowerCase();
  if (!person) return [];
  const counts = new Map<string, number>();
  for (const source of run.artifacts) {
    if (source.author?.toLowerCase() !== person) continue;
    const paths = source.paths ?? (source.kind === 'github_commit_patch' ? [source.externalId.split(':').slice(1).join(':')] : []);
    const areas = new Set(paths.filter(Boolean).map(file => file.split('/').slice(0, file.includes('/') ? 2 : 1).join('/')));
    for (const area of areas) counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([area]) => area);
}

export function dayOneItems(run: Run, items: Item[] = run.items): Item[] {
  if (!run.departingPerson) return [];
  const selected = new Set(run.selectedIds);
  return items.filter(item =>
    item.category === 'next_action' && !item.excluded && !item.needsClarification &&
    item.verification === 'validated_reference' && item.citations.length > 0 &&
    item.citations.every(citation => selected.has(citation.sourceId)) &&
    item.derivationSourceIds?.length && item.derivationSourceIds.every(id => selected.has(id))
  ).slice(0, 3);
}
