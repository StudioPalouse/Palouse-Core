'use client';

import { useState } from 'react';
import type { HandoffState, Task } from '@palouse/shared';
import { Badge, cn } from '@palouse/ui';
import { ChevronRight } from 'lucide-react';
import { TaskRow } from '@/components/task-row';
import { groupTasks, type DisplayConfig } from '@/lib/task-views';

export function TaskList({
  tasks,
  config,
  handoffStates,
  onSelect,
  onHandOff,
}: {
  tasks: Task[];
  config: DisplayConfig;
  /** Task id → state of its current active agent handoff. */
  handoffStates?: Record<string, HandoffState>;
  onSelect: (id: string) => void;
  /** Quick hand-off action on rows without an active handoff. */
  onHandOff?: (id: string) => void;
}) {
  const groups = groupTasks(tasks, config);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // No grouping: render a single flat list, no headers.
  if (config.groupBy === 'none') {
    return (
      <ul className="divide-y">
        {groups[0]?.tasks.map((task) => (
          <li key={task.id}>
            <TaskRow
              task={task}
              handoffState={handoffStates?.[task.id]}
              onSelect={onSelect}
              onHandOff={onHandOff}
            />
          </li>
        ))}
      </ul>
    );
  }

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="divide-y">
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.key);
        return (
          <section key={group.key}>
            <button
              type="button"
              onClick={() => toggle(group.key)}
              aria-expanded={!isCollapsed}
              className="bg-muted/30 hover:bg-accent/50 flex w-full items-center gap-2 px-4 py-2 text-left transition-colors"
            >
              <ChevronRight
                className={cn(
                  'text-muted-foreground size-4 shrink-0 transition-transform',
                  !isCollapsed && 'rotate-90',
                )}
              />
              <span className="text-sm font-medium">{group.label}</span>
              <Badge variant="secondary" className="ml-1">
                {group.tasks.length}
              </Badge>
            </button>
            {!isCollapsed && (
              <ul className="divide-y border-t">
                {group.tasks.map((task) => (
                  <li key={task.id}>
                    <TaskRow
                      task={task}
                      handoffState={handoffStates?.[task.id]}
                      onSelect={onSelect}
                      onHandOff={onHandOff}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
