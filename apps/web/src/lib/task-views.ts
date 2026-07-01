import type { Task } from '@palouse/shared';
import {
  DUE_BUCKET_LABELS,
  DUE_BUCKET_ORDER,
  dueBucket,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  STATUS_LABELS,
  STATUS_ORDER,
} from '@/lib/task-meta';

export type GroupBy = 'none' | 'status' | 'priority' | 'due';
export type SortBy = 'updated' | 'priority' | 'due' | 'title';

export type DisplayConfig = {
  groupBy: GroupBy;
  sortBy: SortBy;
};

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  none: 'None',
  status: 'Status',
  priority: 'Priority',
  due: 'Due date',
};

export const SORT_BY_LABELS: Record<SortBy, string> = {
  updated: 'Recently updated',
  priority: 'Priority',
  due: 'Due date',
  title: 'Title (A–Z)',
};

/**
 * Preset views: one click sets a full DisplayConfig. These are the "default
 * views" the research recommends shipping so the page is useful with zero setup.
 */
export const PRESETS: { id: string; label: string; config: DisplayConfig }[] = [
  { id: 'all', label: 'All', config: { groupBy: 'none', sortBy: 'updated' } },
  { id: 'status', label: 'By status', config: { groupBy: 'status', sortBy: 'priority' } },
  { id: 'priority', label: 'By priority', config: { groupBy: 'priority', sortBy: 'due' } },
  { id: 'due', label: 'By due date', config: { groupBy: 'due', sortBy: 'due' } },
];

export const DEFAULT_DISPLAY: DisplayConfig = PRESETS[0]!.config;

export type TaskGroup = { key: string; label: string; tasks: Task[] };

function compareTasks(a: Task, b: Task, sortBy: SortBy): number {
  switch (sortBy) {
    case 'priority':
      // Lower priority number = more urgent, so ascending puts Urgent first.
      return a.priority - b.priority;
    case 'due': {
      // Soonest first; tasks with no due date sort to the end.
      if (a.dueAt === b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return a.dueAt < b.dueAt ? -1 : 1;
    }
    case 'title':
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    case 'updated':
    default:
      // Most recently updated first (matches the API's default ordering).
      if (a.updatedAt === b.updatedAt) return 0;
      return a.updatedAt < b.updatedAt ? 1 : -1;
  }
}

export function sortTasks(tasks: Task[], sortBy: SortBy): Task[] {
  return [...tasks].sort((a, b) => compareTasks(a, b, sortBy));
}

/** The stable, ordered set of group keys/labels for a grouping axis. */
function groupOrder(groupBy: Exclude<GroupBy, 'none'>): { key: string; label: string }[] {
  switch (groupBy) {
    case 'status':
      return STATUS_ORDER.map((s) => ({ key: s, label: STATUS_LABELS[s] }));
    case 'priority':
      return PRIORITY_ORDER.map((p) => ({ key: String(p), label: PRIORITY_LABELS[p]! }));
    case 'due':
      return DUE_BUCKET_ORDER.map((b) => ({ key: b, label: DUE_BUCKET_LABELS[b] }));
  }
}

/** The group key a single task belongs to for a grouping axis. */
function groupKeyOf(task: Task, groupBy: Exclude<GroupBy, 'none'>): string {
  switch (groupBy) {
    case 'status':
      return task.status;
    case 'priority':
      return String(task.priority);
    case 'due':
      return dueBucket(task.dueAt);
  }
}

/**
 * Group tasks into ordered, sorted sections. When groupBy is 'none' a single
 * unlabeled group holding every task is returned. Empty groups are omitted so
 * the list only shows sections that actually contain tasks.
 */
export function groupTasks(tasks: Task[], config: DisplayConfig): TaskGroup[] {
  const sorted = sortTasks(tasks, config.sortBy);

  if (config.groupBy === 'none') {
    return [{ key: 'all', label: '', tasks: sorted }];
  }

  const byKey = new Map<string, Task[]>();
  for (const task of sorted) {
    const key = groupKeyOf(task, config.groupBy);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(task);
    else byKey.set(key, [task]);
  }

  return groupOrder(config.groupBy)
    .filter((g) => byKey.has(g.key))
    .map((g) => ({ key: g.key, label: g.label, tasks: byKey.get(g.key)! }));
}
