import type { HandoffState, Task, TaskStatus } from '@palouse/shared';
import { Badge } from '@palouse/ui';
import { HANDOFF_STATE_BADGE, HANDOFF_STATE_LABELS } from '@/lib/handoff-meta';
import { formatDate, PRIORITY_LABELS, STATUS_LABELS } from '@/lib/task-meta';

const STATUS_BADGE: Record<TaskStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  open: 'outline',
  in_progress: 'default',
  blocked: 'destructive',
  done: 'secondary',
  archived: 'secondary',
};

export function TaskRow({
  task,
  handoffState,
  onSelect,
}: {
  task: Task;
  /** Live state of the task's current agent handoff, if one is active. */
  handoffState?: HandoffState;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(task.id)}
      className="hover:bg-accent/50 flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
    >
      <Badge variant={STATUS_BADGE[task.status]} className="w-24 justify-center">
        {STATUS_LABELS[task.status]}
      </Badge>
      <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
      {handoffState && (
        <Badge variant={HANDOFF_STATE_BADGE[handoffState]}>
          {HANDOFF_STATE_LABELS[handoffState]}
        </Badge>
      )}
      <span className="text-muted-foreground hidden text-xs sm:inline">
        {PRIORITY_LABELS[task.priority]}
      </span>
      <span className="text-muted-foreground w-16 text-right text-xs">{formatDate(task.dueAt)}</span>
    </button>
  );
}
