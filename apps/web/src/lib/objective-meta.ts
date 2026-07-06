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
 * Soft tonal classes for the status pill. Semantic: planning = neutral,
 * active = blue, at risk = amber, achieved = green, missed = red,
 * archived = muted (no longer live).
 */
export const OBJECTIVE_STATUS_TONE: Record<ObjectiveStatus, string> = {
  planning: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  active: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  at_risk: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  achieved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  missed: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
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
