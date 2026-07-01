'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Task, TaskStatus } from '@palouse/shared';
import {
  Badge,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@palouse/ui';
import { AppShell } from '@/components/app-shell';
import { TasksTabs } from '@/components/tasks-tabs';
import { NewTaskDialog } from '@/components/new-task-dialog';
import { TaskDetailSheet } from '@/components/task-detail-sheet';
import { api } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { formatDate, PRIORITY_LABELS, STATUS_LABELS, STATUS_ORDER } from '@/lib/task-meta';

const STATUS_BADGE: Record<TaskStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  open: 'outline',
  in_progress: 'default',
  blocked: 'destructive',
  done: 'secondary',
  archived: 'secondary',
};

export default function TasksPage() {
  return (
    <AppShell>
      <TasksContent />
    </AppShell>
  );
}

function TasksContent() {
  const { workspace } = useActiveWorkspace();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!workspace) return;
    const params: { status?: string; search?: string } = {};
    if (statusFilter !== 'all') params.status = statusFilter;
    if (search.trim()) params.search = search.trim();
    api.listTasks(workspace.id, params).then(({ tasks }) => setTasks(tasks));
  }, [workspace, statusFilter, search]);

  useEffect(() => {
    const t = setTimeout(refresh, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [refresh, search]);

  return (
    <>
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">
          Tasks
          {workspace && (
            <span className="text-muted-foreground ml-2 text-sm font-normal">{workspace.name}</span>
          )}
        </h1>

        <TasksTabs />

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search tasks…"
            className="h-8 w-48"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto">
            {workspace && <NewTaskDialog workspaceId={workspace.id} onCreated={refresh} />}
          </div>
        </div>

        <div className="rounded-lg border">
          {tasks === null ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-5/6" />
              <Skeleton className="h-5 w-4/6" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="text-muted-foreground p-8 text-center text-sm">
              No tasks yet. Create one, or connect an integration in Settings to start syncing.
            </p>
          ) : (
            <ul className="divide-y">
              {tasks.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedTaskId(task.id)}
                    className="hover:bg-accent/50 flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
                  >
                    <Badge variant={STATUS_BADGE[task.status]} className="w-24 justify-center">
                      {STATUS_LABELS[task.status]}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                    <span className="text-muted-foreground hidden text-xs sm:inline">
                      {PRIORITY_LABELS[task.priority]}
                    </span>
                    <span className="text-muted-foreground w-16 text-right text-xs">
                      {formatDate(task.dueAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {workspace && (
        <TaskDetailSheet
          workspaceId={workspace.id}
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}
