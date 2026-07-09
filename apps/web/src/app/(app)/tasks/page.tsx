'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HandoffState, TaskListItem } from '@palouse/shared';
import {
  Button,
  cn,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@palouse/ui';
import { TasksTabs } from '@/components/tasks-tabs';
import { AgentPickerDialog } from '@/components/agent-picker-dialog';
import { NewTaskDialog } from '@/components/new-task-dialog';
import { TaskDetailSheet } from '@/components/task-detail-sheet';
import { TaskList } from '@/components/task-list';
import { TaskDisplayMenu } from '@/components/task-display-menu';
import { TasksEmptyState } from '@/components/tasks-empty-state';
import { api } from '@/lib/api';
import { HANDOFFS_CHANGED_EVENT } from '@/lib/handoff-meta';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { isCompletedStatus, providerLabel, STATUS_LABELS, STATUS_ORDER } from '@/lib/task-meta';
import { DEFAULT_DISPLAY, PRESETS, type DisplayConfig } from '@/lib/task-views';

// Bumped to v2 when the default view changed to group-by-status; the old key is
// ignored so existing users pick up the new default instead of their saved one.
const DISPLAY_STORAGE_KEY = 'palouse.tasks.display.v2';
const HANDOFF_POLL_MS = 15_000;

function loadDisplay(): DisplayConfig {
  if (typeof window === 'undefined') return DEFAULT_DISPLAY;
  try {
    const raw = window.localStorage.getItem(DISPLAY_STORAGE_KEY);
    if (raw) return { ...DEFAULT_DISPLAY, ...(JSON.parse(raw) as Partial<DisplayConfig>) };
  } catch {
    // ignore malformed storage
  }
  return DEFAULT_DISPLAY;
}

export default function TasksPage() {
  return <TasksContent />;
}

function TasksContent() {
  const { workspace } = useActiveWorkspace();
  const [tasks, setTasks] = useState<TaskListItem[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // Tasks being handed off via the picker: one from a row's quick action,
  // several from the multi-select bar.
  const [pickerTaskIds, setPickerTaskIds] = useState<string[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const [display, setDisplay] = useState<DisplayConfig>(DEFAULT_DISPLAY);

  // Hydrate the saved display config on the client, then persist on change.
  useEffect(() => setDisplay(loadDisplay()), []);
  const updateDisplay = useCallback((next: DisplayConfig) => {
    setDisplay(next);
    try {
      window.localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage failures (private mode, quota)
    }
  }, []);

  const activePreset = PRESETS.find(
    (p) => p.config.groupBy === display.groupBy && p.config.sortBy === display.sortBy,
  )?.id;

  const refresh = useCallback(() => {
    if (!workspace) return;
    // Grouping and sorting happen client-side, so pull a full page of tasks.
    const params: { status?: string; search?: string; limit?: number } = { limit: 200 };
    if (statusFilter !== 'all') params.status = statusFilter;
    if (search.trim()) params.search = search.trim();
    api.listTasks(workspace.id, params).then(({ tasks }) => setTasks(tasks));
  }, [workspace, statusFilter, search]);

  // Complete or reopen a task inline. Optimistically update the local list so
  // the row responds instantly, then refetch to reconcile.
  const completeTask = useCallback(
    (id: string, done: boolean) => {
      if (!workspace) return;
      const status = done ? 'done' : 'open';
      setTasks((prev) => prev?.map((t) => (t.id === id ? { ...t, status } : t)) ?? prev);
      api
        .updateTask(workspace.id, id, { status })
        .then(refresh)
        .catch(refresh);
    },
    [workspace, refresh],
  );

  // Provider filter options, derived from the tasks actually present so the
  // dropdown only offers providers in use ("Native" = tasks with no external
  // source). Shown only when there is a real choice between two or more.
  const providerOptions = useMemo(() => {
    const slugs = new Set<string>();
    let hasNative = false;
    for (const t of tasks ?? []) {
      if (t.providers.length === 0) hasNative = true;
      else for (const p of t.providers) slugs.add(p);
    }
    const opts = hasNative ? [{ value: 'native', label: providerLabel('native') }] : [];
    for (const slug of [...slugs].sort()) opts.push({ value: slug, label: providerLabel(slug) });
    return opts;
  }, [tasks]);

  // Drop a provider filter that is no longer available (e.g. its last task synced
  // away), so the control never points at a hidden value.
  useEffect(() => {
    if (sourceFilter !== 'all' && !providerOptions.some((o) => o.value === sourceFilter)) {
      setSourceFilter('all');
    }
  }, [sourceFilter, providerOptions]);

  // Apply the client-side filters: provider, then completed. Completed (done or
  // archived) tasks are hidden unless the Display toggle is on or a specific
  // status is filtered (then honour that choice).
  const visibleTasks = useMemo(() => {
    if (tasks === null) return null;
    let list = tasks;
    if (sourceFilter !== 'all') {
      list = list.filter((t) =>
        sourceFilter === 'native'
          ? t.providers.length === 0
          : (t.providers as string[]).includes(sourceFilter),
      );
    }
    if (!display.showCompleted && statusFilter === 'all') {
      list = list.filter((t) => !isCompletedStatus(t.status));
    }
    return list;
  }, [tasks, sourceFilter, display.showCompleted, statusFilter]);

  useEffect(() => {
    const t = setTimeout(refresh, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [refresh, search]);

  // Agent work (create_task, status updates, completions) lands server-side
  // with nothing to signal the client, so the list itself polls on the same
  // cadence as the handoff badges. In-app hand-off actions refetch immediately
  // via the handoffs-changed event.
  useEffect(() => {
    const t = setInterval(refresh, HANDOFF_POLL_MS);
    window.addEventListener(HANDOFFS_CHANGED_EVENT, refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener(HANDOFFS_CHANGED_EVENT, refresh);
    };
  }, [refresh]);

  // Active agent handoffs, so rows can show what agents are up to. Kept
  // fresh with a light poll plus the handoffs-changed signal from actions
  // taken in the detail sheet.
  const [handoffStates, setHandoffStates] = useState<Record<string, HandoffState>>({});
  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    const load = () => {
      api
        .listHandoffs(workspace.id, { active: true, limit: 100 })
        .then(({ handoffs }) => {
          if (cancelled) return;
          const map: Record<string, HandoffState> = {};
          // Rows come newest-first; keep the most recent handoff per task.
          for (const h of handoffs) if (!(h.taskId in map)) map[h.taskId] = h.state;
          setHandoffStates(map);
        })
        .catch(() => {
          // Transient fetch errors keep the last known badges.
        });
    };
    load();
    const t = setInterval(load, HANDOFF_POLL_MS);
    window.addEventListener(HANDOFFS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener(HANDOFFS_CHANGED_EVENT, load);
    };
  }, [workspace]);

  // Selection only holds visible tasks that are still eligible for hand-off;
  // rows that gain an active handoff or drop out of the filter fall away.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(
        (tasks ?? []).filter((t) => prev.has(t.id) && !handoffStates[t.id]).map((t) => t.id),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [tasks, handoffStates]);

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

        <div className="flex flex-wrap items-center gap-1">
          {PRESETS.map((preset) => (
            <Button
              key={preset.id}
              variant={activePreset === preset.id ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(activePreset !== preset.id && 'text-muted-foreground')}
              onClick={() => updateDisplay({ ...display, ...preset.config })}
            >
              {preset.label}
            </Button>
          ))}
        </div>

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
          {providerOptions.length > 1 && (
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                {providerOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <TaskDisplayMenu config={display} onChange={updateDisplay} />
          <div className="ml-auto">
            {workspace && <NewTaskDialog workspaceId={workspace.id} onCreated={refresh} />}
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
            <p className="text-sm">
              {selectedIds.size} task{selectedIds.size === 1 ? '' : 's'} selected
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
              <Button size="sm" onClick={() => setPickerTaskIds([...selectedIds])}>
                Hand off to agent
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-lg border">
          {tasks === null ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-5/6" />
              <Skeleton className="h-5 w-4/6" />
            </div>
          ) : tasks.length === 0 ? (
            <TasksEmptyState role={workspace?.role} />
          ) : visibleTasks && visibleTasks.length === 0 ? (
            <p className="text-muted-foreground p-8 text-center text-sm">
              No tasks match these filters. Adjust the provider or status filter, or turn on
              &ldquo;Show completed&rdquo; in Display.
            </p>
          ) : (
            <TaskList
              tasks={visibleTasks ?? []}
              config={display}
              handoffStates={handoffStates}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onSelect={setSelectedTaskId}
              onComplete={completeTask}
              onHandOff={(id) => setPickerTaskIds([id])}
            />
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

      {workspace && pickerTaskIds && (
        <AgentPickerDialog
          workspaceId={workspace.id}
          taskIds={pickerTaskIds}
          open
          onOpenChange={(open) => {
            if (!open) setPickerTaskIds(null);
          }}
          onHandedOff={() => {
            setPickerTaskIds(null);
            setSelectedIds(new Set());
          }}
        />
      )}
    </>
  );
}
