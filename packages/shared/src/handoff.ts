import { z } from 'zod';
import { uuid } from './ids.js';

export const handoffState = z.enum([
  'queued',
  'claimed',
  'in_progress',
  'needs_review',
  'completed',
  'failed',
  'cancelled',
]);
export type HandoffState = z.infer<typeof handoffState>;

export const reviewDecision = z.enum(['approved', 'rejected']);
export type ReviewDecision = z.infer<typeof reviewDecision>;

export const handoffSchema = z.object({
  id: uuid,
  taskId: uuid,
  workspaceId: uuid,
  actorAgentId: uuid,
  state: handoffState,
  claimedAt: z.string().datetime().nullable(),
  lastHeartbeatAt: z.string().datetime().nullable(),
  deadlineAt: z.string().datetime().nullable(),
  deadlineMinutes: z.number().int(),
  requeueCount: z.number().int(),
  resultSummaryMd: z.string().nullable(),
  failureReason: z.string().nullable(),
  requestedByUserId: uuid.nullable(),
  reviewRequired: z.boolean(),
  reviewedByUserId: uuid.nullable(),
  reviewedAt: z.string().datetime().nullable(),
  reviewDecision: reviewDecision.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Handoff = z.infer<typeof handoffSchema>;

// List rows carry display context so the review queue and task panel don't
// need an extra request per handoff.
export const handoffListItemSchema = handoffSchema.extend({
  taskTitle: z.string().nullable(),
  agentName: z.string().nullable(),
});
export type HandoffListItem = z.infer<typeof handoffListItemSchema>;

export const handoffEventSchema = z.object({
  id: uuid,
  handoffId: uuid,
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()),
  at: z.string().datetime(),
});
export type HandoffEvent = z.infer<typeof handoffEventSchema>;

export const createHandoffInput = z.object({
  agentId: uuid,
  reviewRequired: z.boolean().default(false),
  deadlineMinutes: z.number().int().min(1).max(24 * 60).default(30),
});
export type CreateHandoffInput = z.infer<typeof createHandoffInput>;

export const listHandoffsQuery = z.object({
  workspaceId: uuid,
  state: handoffState.optional(),
  // Narrows to non-terminal states (queued/claimed/in_progress/needs_review),
  // e.g. to badge task rows with live agent activity in one request.
  active: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional(),
  agentId: uuid.optional(),
  taskId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListHandoffsQuery = z.infer<typeof listHandoffsQuery>;

export const reviewHandoffInput = z.object({
  decision: reviewDecision,
  note: z.string().max(4000).optional(),
  // What happens to a rejected handoff: send it back to the agent or fail it.
  rejectAction: z.enum(['retry', 'fail']).default('retry'),
});
export type ReviewHandoffInput = z.infer<typeof reviewHandoffInput>;

export const TERMINAL_STATES: ReadonlySet<HandoffState> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export function isTerminal(state: HandoffState): boolean {
  return TERMINAL_STATES.has(state);
}
