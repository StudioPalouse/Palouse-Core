import { z } from 'zod';
import { uuid } from './ids.js';

// ms_tasks is the unified Microsoft connection (To Do + Planner via one Graph
// consent). ms_todo/ms_planner remain for rows created before the merge.
export const integrationProvider = z.enum([
  'google_tasks',
  'ms_tasks',
  'ms_todo',
  'ms_planner',
  'asana',
  'notion',
  'todoist',
]);
export type IntegrationProvider = z.infer<typeof integrationProvider>;

export const integrationStatus = z.enum(['active', 'degraded', 'revoked']);
export type IntegrationStatus = z.infer<typeof integrationStatus>;

/** Public DTO — never carries token material. */
export const integrationSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  provider: integrationProvider,
  accountLabel: z.string(),
  status: integrationStatus,
  scopes: z.array(z.string()),
  lastSyncAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Integration = z.infer<typeof integrationSchema>;
