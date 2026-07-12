import type { DecisionEntityType, DecisionStatus, RaciRole } from '@palouse/shared';

export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  proposed: 'Proposed',
  under_review: 'Under review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  deprecated: 'Deprecated',
  superseded: 'Superseded',
};

/** Lifecycle order, earliest stage first. Drives the status dropdown. */
export const DECISION_STATUS_ORDER: DecisionStatus[] = [
  'proposed',
  'under_review',
  'accepted',
  'rejected',
  'deprecated',
  'superseded',
];

/**
 * Soft tonal classes for the status pill, from the Fieldwork semantic status
 * tokens (docs/design-system.md): proposed = sky, under review = amber,
 * accepted = emerald, rejected = rose, deprecated/superseded = muted (no longer
 * live).
 */
export const DECISION_STATUS_TONE: Record<DecisionStatus, string> = {
  proposed: 'bg-status-open-bg text-status-open',
  under_review: 'bg-status-progress-bg text-status-progress',
  accepted: 'bg-status-done-bg text-status-done',
  rejected: 'bg-status-blocked-bg text-status-blocked',
  deprecated: 'bg-muted text-muted-foreground',
  superseded: 'bg-muted text-muted-foreground',
};

export const RACI_LABELS: Record<RaciRole, string> = {
  responsible: 'Responsible',
  accountable: 'Accountable',
  consulted: 'Consulted',
  informed: 'Informed',
};

/** RACI order for pickers and rosters (the canonical R, A, C, I sequence). */
export const RACI_ORDER: RaciRole[] = ['responsible', 'accountable', 'consulted', 'informed'];

/** One-letter chip label for a RACI role. */
export const RACI_INITIAL: Record<RaciRole, string> = {
  responsible: 'R',
  accountable: 'A',
  consulted: 'C',
  informed: 'I',
};

export const ENTITY_TYPE_LABELS: Record<DecisionEntityType, string> = {
  task: 'Task',
  project: 'Project',
  project_item: 'Card',
  goal: 'Goal',
  key_result: 'Key result',
  context: 'Context',
};

/** Empty-value placeholder glyph (en-dash, per the copy convention). */
export const EMPTY = '–';

export function formatDate(iso: string | null): string {
  if (!iso) return EMPTY;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
