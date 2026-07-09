import type { HandoffState, Task } from '@palouse/shared';
import { Bot, CheckCircle2, Circle } from 'lucide-react';
import { Badge, Button, cn } from '@palouse/ui';
import { HANDOFF_STATE_BADGE, HANDOFF_STATE_LABELS } from '@/lib/handoff-meta';
import { formatDate, PRIORITY_LABELS, STATUS_LABELS, STATUS_TONE } from '@/lib/task-meta';

export function TaskRow({
  task,
  handoffState,
  selected = false,
  selectionActive = false,
  onToggleSelect,
  onSelect,
  onComplete,
  onHandOff,
}: {
  task: Task;
  /** Live state of the task's current agent handoff, if one is active. */
  handoffState?: HandoffState;
  selected?: boolean;
  /** True while any row is selected, keeping every checkbox visible. */
  selectionActive?: boolean;
  onToggleSelect?: (id: string) => void;
  onSelect: (id: string) => void;
  /** Mark the task done (or reopen it) inline. `done` is the target state. */
  onComplete?: (id: string, done: boolean) => void;
  /** Quick hand-off from the row; shown on hover when no handoff is active. */
  onHandOff?: (id: string) => void;
}) {
  // Tasks already with an agent can't be handed off again, so they can't be
  // selected either; the checkbox keeps its slot to preserve alignment.
  const selectable = !handoffState;
  const done = task.status === 'done';
  return (
    <div className="group hover:bg-accent/50 flex w-full items-center transition-colors">
      {onToggleSelect && (
        <label
          className={cn(
            'hidden shrink-0 items-center self-stretch pl-4 sm:flex',
            !selectable && 'invisible',
          )}
        >
          <input
            type="checkbox"
            aria-label={`Select ${task.title}`}
            className={cn(
              'accent-foreground size-4 transition-opacity',
              selected || selectionActive
                ? 'opacity-100'
                : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
            )}
            checked={selected}
            disabled={!selectable}
            onChange={() => onToggleSelect(task.id)}
          />
        </label>
      )}
      {onComplete && (
        <button
          type="button"
          aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
          onClick={() => onComplete(task.id, !done)}
          className={cn(
            'flex shrink-0 items-center self-stretch pl-4',
            onToggleSelect && 'sm:pl-2',
          )}
        >
          {done ? (
            <CheckCircle2 className="text-status-done size-[18px]" />
          ) : (
            <Circle className="text-muted-foreground hover:text-foreground size-[18px] transition-colors" />
          )}
        </button>
      )}
      <button
        type="button"
        onClick={() => onSelect(task.id)}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-3 text-left',
          onComplete ? 'pl-3' : 'pl-4',
        )}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            done && 'text-muted-foreground line-through',
          )}
        >
          {task.title}
        </span>
        {task.origin === 'agent' && (
          <Badge variant="outline" className="gap-1">
            <Bot className="size-3" />
            Agent
          </Badge>
        )}
        {handoffState && (
          <Badge variant={HANDOFF_STATE_BADGE[handoffState]}>
            {HANDOFF_STATE_LABELS[handoffState]}
          </Badge>
        )}
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
            STATUS_TONE[task.status],
          )}
        >
          {STATUS_LABELS[task.status]}
        </span>
        <span className="text-muted-foreground hidden w-14 text-right text-xs sm:inline">
          {PRIORITY_LABELS[task.priority]}
        </span>
        <span className="text-muted-foreground w-14 text-right text-xs">
          {formatDate(task.dueAt)}
        </span>
      </button>
      {onHandOff && selectable && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground mr-2 hidden opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 sm:inline-flex"
          onClick={() => onHandOff(task.id)}
        >
          <Bot className="size-3.5" />
          Hand off
        </Button>
      )}
    </div>
  );
}
