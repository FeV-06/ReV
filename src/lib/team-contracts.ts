import { z } from 'zod';

export const teamConfigurationSchema = z.object({
  url: z.string().url().max(1000),
  publishableKey: z.string().min(1).max(2048),
  accessToken: z.string().min(1).max(8192),
  teamId: z.string().uuid(),
}).strict();

export const teamProjectRequestSchema = z.object({ projectRoot: z.string().min(1).max(4096).optional() }).strict();
export const teamSyncRequestSchema = z.object({
  previewId: z.string().uuid(),
  projectRoot: z.string().min(1).max(4096).optional(),
  shareAnalysis: z.boolean(),
  sharedRunIds: z.array(z.string().uuid()).max(100),
  confirm: z.literal(true),
}).strict();

export type TeamConfiguration = z.infer<typeof teamConfigurationSchema>;
export type TeamSyncRequest = z.infer<typeof teamSyncRequestSchema>;
export type RemoteDocument = {
  team_id: string;
  project_key: string;
  kind: 'analysis' | 'handover';
  doc_key: string;
  revision: number;
  payload: unknown;
  author_id?: string;
};
