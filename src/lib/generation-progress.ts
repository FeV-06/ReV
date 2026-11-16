export type TriageStats = {
  status: 'available' | 'unavailable' | 'disabled' | 'no_candidates' | 'fixture';
  evaluated: number;
  retained: number;
  skipped: number;
  unevaluated: number;
};

export type GenerationProgress = {
  phase: 'collecting' | 'triage' | 'synthesis' | 'verification';
  triage?: TriageStats;
};
