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
 * Soft tonal classes for the status pill, from the Fieldwork semantic status
 * tokens (docs/design-system.md): planning = sky, active = blue, on hold =
 * amber, completed = emerald/achieved, archived = muted.
 */
export const PROJECT_STATUS_TONE: Record<ProjectStatus, string> = {
  planning: 'bg-status-open-bg text-status-open',
  active: 'bg-status-active-bg text-status-active',
  on_hold: 'bg-status-progress-bg text-status-progress',
  completed: 'bg-status-done-bg text-status-done',
  archived: 'bg-muted text-muted-foreground',
};

/** Empty-value placeholder glyph (en-dash, per the copy convention). */
export const EMPTY = '–';

export function formatDate(iso: string | null): string {
  if (!iso) return EMPTY;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
