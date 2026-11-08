import { z } from 'zod';

export const artifactSchema = z.object({
  id: z.string().uuid(), kind: z.enum(['github_commit', 'github_pr', 'slack_message']),
  externalId: z.string(), text: z.string(), author: z.string().nullable(),
  timestamp: z.string().nullable(), url: z.string().url().nullable(), sourceRef: z.string(),
});
export type Artifact = z.infer<typeof artifactSchema>;

export const citationSchema = z.object({ sourceId: z.string().uuid(), quote: z.string(), startByte: z.number().int().nonnegative(), endByte: z.number().int().nonnegative() });
export const itemSchema = z.object({
  id: z.string().uuid(), category: z.enum(['decision', 'open_work', 'risk', 'dependency', 'next_action', 'contact', 'unknown']),
  text: z.string().min(1).max(4000), citations: z.array(citationSchema),
  verification: z.enum(['validated_reference', 'unverified', 'needs_review']),
  excluded: z.boolean(), needsClarification: z.boolean(),
});
export type Item = z.infer<typeof itemSchema>;
export const importSchema = z.object({ artifacts: z.array(artifactSchema), warnings: z.array(z.string()) });
export const draftSchema = z.object({ items: z.array(itemSchema), mode: z.string().optional() });
export type RunState = 'importing' | 'awaiting_scope_confirmation' | 'reconstructing' | 'needs_review' | 'approved' | 'failed';
export type Run = { id: string; recipient: string; createdAt: string; state: RunState; artifacts: Artifact[]; warnings: string[]; selectedIds: string[]; items: Item[]; mode: string | null; revision: number; approvedRevision: number | null; acceptedPartial: boolean };
