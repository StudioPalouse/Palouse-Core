import type { ProjectStatus } from '@palouse/shared';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
};

/** Lifecycle order, earliest stage first. Drives the status dropdown. */
export const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  'planning',
  'active',
  'on_hold',
  'completed',
  'archived',
];

/**
 * Soft tonal classes for the status pill. Semantic: planning = neutral,
 * active = blue, on hold = amber, completed = green, archived = muted.
 */
export const PROJECT_STATUS_TONE: Record<ProjectStatus, string> = {
  planning: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  active: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  on_hold: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  archived: 'bg-muted text-muted-foreground',
};

/** Empty-value placeholder glyph (en-dash, per the copy convention). */
export const EMPTY = '–';

export function formatDate(iso: string | null): string {
  if (!iso) return EMPTY;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
