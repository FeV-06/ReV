import { z } from 'zod';

export const artifactSchema = z.object({
  id: z.string().uuid(), kind: z.enum(['git_commit', 'git_document', 'github_commit', 'github_pr', 'github_review_comment', 'github_discussion_comment', 'github_commit_patch', 'code_symbol', 'working_change', 'slack_message', 'review_answer', 'review_redaction']),
  externalId: z.string(), text: z.string(), author: z.string().nullable(),
  timestamp: z.string().nullable(), url: z.string().url().nullable(), sourceRef: z.string(),
  githubLogin: z.string().min(1).max(100).optional(),
  paths: z.array(z.string()).optional(),
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
export const graphEdgeTypeSchema = z.enum(['supports','implements','supersedes','contradicts']);
export const graphEdgeSchema = z.object({id:z.string().uuid(),fromId:z.string().uuid(),toId:z.string().uuid(),type:graphEdgeTypeSchema,evidenceSourceIds:z.array(z.string().uuid()).min(1).max(50),status:z.enum(['proposed','confirmed','rejected']),createdAt:z.string()});
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export const graphEventSchema = z.object({id:z.string().uuid(),type:z.enum(['edge_proposed','edge_confirmed','edge_rejected']),edge:graphEdgeSchema,at:z.string(),epoch:z.string().uuid().optional()});
export type GraphEvent = z.infer<typeof graphEventSchema>;
export const gapSchema=z.object({id:z.string().uuid(),itemId:z.string().uuid().optional(),origin:z.enum(['interview','successor']).optional(),sourceIds:z.array(z.string().uuid()),question:z.string(),status:z.enum(['open','answered']),answerSourceId:z.string().uuid().optional()});
export type Gap=z.infer<typeof gapSchema>;
export const sourceEventSchema=z.object({id:z.string().uuid(),type:z.literal('source_redacted'),parentSourceId:z.string().uuid(),redactedSourceId:z.string().uuid(),at:z.string()});
export type SourceEvent=z.infer<typeof sourceEventSchema>;
export const githubUsernameSchema=z.string().min(1).max(39).regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/,'Enter a GitHub username without @');
export const targetRoleSchema=z.string().min(1).max(120).regex(/\S/,'Target role must not be empty');
export const successorEmailSchema = z.string().trim().max(254).email();
export const runSchema = z.object({
  id: z.string().uuid(),
  recipient: z.string(),
  successorEmail: successorEmailSchema.optional(),
  githubUsername: githubUsernameSchema.optional(),
  targetRole: targetRoleSchema.optional(),
  departingPerson: z.string().optional(),
  projectRoot: z.string().optional(),
  takeoverScope: z.string().optional(),
  createdAt: z.string(),
  state: runStateSchema,
  artifacts: z.array(artifactSchema),
  warnings: z.array(z.string()),
  selectedIds: z.array(z.string().uuid()),
  items: z.array(itemSchema),
  mode: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  approvedRevision: z.number().int().nonnegative().nullable(),
  acceptedPartial: z.boolean(),
  graphEvents: z.array(graphEventSchema).optional(),
  graphEpoch: z.string().uuid().optional(),
  gaps: z.array(gapSchema).optional(),
  sourceEvents: z.array(sourceEventSchema).optional()
});
export type RunState = z.infer<typeof runStateSchema>;
export type Run = z.infer<typeof runSchema>;
