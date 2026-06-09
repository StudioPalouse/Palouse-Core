import { z } from 'zod';
import { uuid } from './ids.js';

export const memberRole = z.enum(['owner', 'admin', 'member', 'viewer']);
export type MemberRole = z.infer<typeof memberRole>;

export const workspaceSchema = z.object({
  id: uuid,
  organizationId: uuid,
  name: z.string(),
  slug: z.string(),
  role: memberRole,
  createdAt: z.string().datetime(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const slug = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'lowercase letters, numbers and hyphens only');

export const createWorkspaceInput = z.object({
  name: z.string().min(1).max(120),
  slug,
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;
