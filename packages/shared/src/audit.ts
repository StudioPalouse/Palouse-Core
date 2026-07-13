import { z } from 'zod';
import { uuid } from './ids.js';

/**
 * The activity feed reads back the `audit_events` spine. Recording is never
 * gated; this query surface is (behind the `audit` capability). By default the
 * feed hides the redundant `mcp.*` tool-call rows (every agent mutation already
 * writes a clean entity-targeted row), so business users see what happened to
 * the work, not raw RPC chatter. Set `includeReads` to surface them.
 */
export const listAuditEventsQuery = z.object({
  workspaceId: uuid,
  action: z.string().max(200).optional(),
  actorType: z.enum(['user', 'agent']).optional(),
  targetType: z.string().max(100).optional(),
  search: z.string().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  includeReads: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListAuditEventsQuery = z.infer<typeof listAuditEventsQuery>;

/**
 * An enriched audit row for the activity feed: raw columns plus a resolved
 * actor name, a resolved target label, and a plain-English `summary`.
 */
export const auditEventListItemSchema = z.object({
  id: uuid,
  action: z.string(),
  actorType: z.string(),
  actorId: uuid.nullable(),
  actorName: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: uuid.nullable(),
  targetLabel: z.string().nullable(),
  summary: z.string(),
  payload: z.record(z.string(), z.unknown()),
  at: z.string(),
});
export type AuditEventListItem = z.infer<typeof auditEventListItemSchema>;

export const auditEventListResultSchema = z.object({
  events: z.array(auditEventListItemSchema),
  total: z.number().int(),
});
export type AuditEventListResult = z.infer<typeof auditEventListResultSchema>;
