import type { GenerationProgress } from '@/lib/generation-progress';

// Advisory, process-local phase data. Persisted run state remains authoritative.
const active = new Map<string, GenerationProgress>();

export function setGenerationProgress(id: string, progress: GenerationProgress): void {
  active.set(id, progress);
}
export function getGenerationProgress(id: string): GenerationProgress | null {
  return active.get(id) ?? null;
}
export function clearGenerationProgress(id: string): void {
  active.delete(id);
}
