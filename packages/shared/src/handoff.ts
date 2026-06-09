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

export const handoffSchema = z.object({
  id: uuid,
  taskId: uuid,
  workspaceId: uuid,
  actorAgentId: uuid,
  state: handoffState,
  claimToken: uuid.nullable(),
  claimedAt: z.string().datetime().nullable(),
  lastHeartbeatAt: z.string().datetime().nullable(),
  deadlineAt: z.string().datetime().nullable(),
  resultSummaryMd: z.string().nullable(),
  failureReason: z.string().nullable(),
  requestedByUserId: uuid,
  reviewRequired: z.boolean(),
});
export type Handoff = z.infer<typeof handoffSchema>;

export const TERMINAL_STATES: ReadonlySet<HandoffState> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export function isTerminal(state: HandoffState): boolean {
  return TERMINAL_STATES.has(state);
}
