import type { ObjectiveStatus } from '@palouse/shared';

export const OBJECTIVE_STATUS_LABELS: Record<ObjectiveStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  at_risk: 'At risk',
  achieved: 'Achieved',
  missed: 'Missed',
  archived: 'Archived',
};

/** Lifecycle order, earliest stage first. Drives the status dropdown. */
export const OBJECTIVE_STATUS_ORDER: ObjectiveStatus[] = [
  'planning',
  'active',
  'at_risk',
  'achieved',
  'missed',
  'archived',
];

/**
 * Soft tonal classes for the status pill, from the Fieldwork semantic status
 * tokens (docs/design-system.md): planning = sky, active = blue, at risk =
 * amber, achieved = emerald, missed = rose, archived = muted (no longer live).
 */
export const OBJECTIVE_STATUS_TONE: Record<ObjectiveStatus, string> = {
  planning: 'bg-status-open-bg text-status-open',
  active: 'bg-status-active-bg text-status-active',
  at_risk: 'bg-status-progress-bg text-status-progress',
  achieved: 'bg-status-done-bg text-status-done',
  missed: 'bg-status-blocked-bg text-status-blocked',
  archived: 'bg-muted text-muted-foreground',
};

/** Empty-value placeholder glyph (en-dash, per the copy convention). */
export const EMPTY = '–';

export function formatDate(iso: string | null): string {
  if (!iso) return EMPTY;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Render a key-result value with its unit. A unit of '%' or '$' hugs the number
 * ('75%', '$40'); any other unit trails with a space ('40 users'). Trailing
 * zeros from floating-point storage are trimmed.
 */
export function formatKeyResultValue(value: number, unit: string | null): string {
  const n = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  if (!unit) return n;
  if (unit === '%') return `${n}%`;
  if (unit === '$') return `$${n}`;
  return `${n} ${unit}`;
}
