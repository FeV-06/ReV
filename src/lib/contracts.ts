import { z } from 'zod';

export const artifactSchema = z.object({
  id: z.string().uuid(), kind: z.enum(['github_commit', 'github_pr', 'github_review_comment', 'github_discussion_comment', 'github_commit_patch', 'slack_message']),
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
  derivationSourceIds: z.array(z.string().uuid()).optional(),
});
export type Item = z.infer<typeof itemSchema>;
export const importSchema = z.object({ artifacts: z.array(artifactSchema), warnings: z.array(z.string()) });
export const draftSchema = z.object({ items: z.array(itemSchema), mode: z.string().optional() });
export const modelEvidenceSchema = z.object({sourceId:z.string().uuid(),quote:z.string()});
export const modelCandidateSchema = z.object({category:itemSchema.shape.category,text:z.string().min(1).max(4000),evidence:z.array(modelEvidenceSchema).max(10)});
export const modelResponseSchema = z.object({items:z.array(modelCandidateSchema).max(100)});
export const runStateSchema = z.enum(['importing','awaiting_scope_confirmation','reconstructing','needs_review','approved','failed']);
export const runSchema = z.object({ id:z.string().uuid(), recipient:z.string(), createdAt:z.string(), state:runStateSchema, artifacts:z.array(artifactSchema), warnings:z.array(z.string()), selectedIds:z.array(z.string().uuid()), items:z.array(itemSchema), mode:z.string().nullable(), revision:z.number().int().nonnegative(), approvedRevision:z.number().int().nonnegative().nullable(), acceptedPartial:z.boolean() });
export type RunState = z.infer<typeof runStateSchema>;
export type Run = z.infer<typeof runSchema>;
