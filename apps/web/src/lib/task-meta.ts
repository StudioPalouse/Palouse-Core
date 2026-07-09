import type { TaskStatus } from '@palouse/shared';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  archived: 'Archived',
};

export const STATUS_ORDER: TaskStatus[] = ['open', 'in_progress', 'blocked', 'done', 'archived'];

/**
 * Soft tonal classes for the status label pill. Filled tints (no border) so a
 * status reads as a passive tag, not a button. Colours come from the Fieldwork
 * semantic status tokens (docs/design-system.md): open = sky/planning, in
 * progress = amber, blocked = rose, done = emerald/achieved.
 */
export const STATUS_TONE: Record<TaskStatus, string> = {
  open: 'bg-status-open-bg text-status-open',
  in_progress: 'bg-status-progress-bg text-status-progress',
  blocked: 'bg-status-blocked-bg text-status-blocked',
  done: 'bg-status-done-bg text-status-done',
  archived: 'bg-muted text-muted-foreground',
};

/** Terminal statuses treated as "completed" and hidden from the list by default. */
export function isCompletedStatus(status: TaskStatus): boolean {
  return status === 'done' || status === 'archived';
}

/**
 * Human labels for a task's provider (the external system it syncs from).
 * "native" is the synthetic provider for tasks with no external source.
 */
export const PROVIDER_LABELS: Record<string, string> = {
  native: 'Native',
  todoist: 'Todoist',
  google_tasks: 'Google Tasks',
  ms_todo: 'Microsoft To Do',
  ms_planner: 'Microsoft Planner',
  asana: 'Asana',
  notion: 'Notion',
  palouse: 'Native',
};

/** Pretty label for a provider slug, falling back to the raw slug. */
export function providerLabel(slug: string): string {
  return PROVIDER_LABELS[slug] ?? slug;
}

export const PRIORITY_LABELS: Record<number, string> = {
  0: 'Urgent',
  1: 'High',
  2: 'Medium',
  3: 'Low',
  4: 'None',
};

/** Priority values from most to least urgent. */
export const PRIORITY_ORDER: number[] = [0, 1, 2, 3, 4];

export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none';

/** Ordered due-date buckets, soonest first, with "no date" last. */
export const DUE_BUCKET_ORDER: DueBucket[] = ['overdue', 'today', 'week', 'later', 'none'];

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  later: 'Later',
  none: 'No due date',
};

/**
 * Bucket a task's due date relative to now, for date grouping. "This week" means
 * within the next 7 days after today. Browser-local time is intentional here.
 */
export function dueBucket(iso: string | null): DueBucket {
  if (!iso) return 'none';
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return 'none';

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  if (due < startOfToday) return 'overdue';
  if (due < startOfTomorrow) return 'today';
  if (due < endOfWeek) return 'week';
  return 'later';
}

export function formatDate(iso: string | null): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
