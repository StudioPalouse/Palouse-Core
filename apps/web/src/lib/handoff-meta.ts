import type { HandoffState } from '@reqops/shared';

// Business-friendly copy: "handoff" renders as "Agent task" and states avoid
// state-machine jargon.
export const HANDOFF_STATE_LABELS: Record<HandoffState, string> = {
  queued: 'Waiting for agent',
  claimed: 'Agent working',
  in_progress: 'Agent working',
  needs_review: 'Needs your review',
  completed: 'Done',
  failed: "Didn't finish",
  cancelled: 'Cancelled',
};

export const HANDOFF_STATE_BADGE: Record<
  HandoffState,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  queued: 'outline',
  claimed: 'default',
  in_progress: 'default',
  needs_review: 'destructive',
  completed: 'secondary',
  failed: 'destructive',
  cancelled: 'secondary',
};

export const ACTIVE_HANDOFF_STATES: HandoffState[] = [
  'queued',
  'claimed',
  'in_progress',
  'needs_review',
];

export const EVENT_LABELS: Record<string, string> = {
  queued: 'Handed off to agent',
  claimed: 'Agent picked it up',
  requeued: 'Agent went quiet — queued for another attempt',
  review_requested: 'Agent asked for your review',
  reviewed: 'Reviewed',
  completed: 'Agent finished',
  failed: "Agent couldn't finish",
  cancelled: 'Cancelled',
};

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
