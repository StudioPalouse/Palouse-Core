'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HandoffState, Task } from '@palouse/shared';
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
import { api } from '@/lib/api';
import { HANDOFFS_CHANGED_EVENT } from '@/lib/handoff-meta';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { STATUS_LABELS, STATUS_ORDER } from '@/lib/task-meta';
import {
  DEFAULT_DISPLAY,
  PRESETS,
  type DisplayConfig,
} from '@/lib/task-views';

const DISPLAY_STORAGE_KEY = 'palouse.tasks.display';
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
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // Task getting a quick hand-off straight from its row, skipping the sheet.
  const [handOffTaskId, setHandOffTaskId] = useState<string | null>(null);
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

  useEffect(() => {
    const t = setTimeout(refresh, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [refresh, search]);

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
              onClick={() => updateDisplay(preset.config)}
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
          <TaskDisplayMenu config={display} onChange={updateDisplay} />
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
            <TaskList
              tasks={tasks}
              config={display}
              handoffStates={handoffStates}
              onSelect={setSelectedTaskId}
              onHandOff={setHandOffTaskId}
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

      {workspace && handOffTaskId && (
        <AgentPickerDialog
          workspaceId={workspace.id}
          taskId={handOffTaskId}
          open
          onOpenChange={(open) => {
            if (!open) setHandOffTaskId(null);
          }}
          onHandedOff={() => setHandOffTaskId(null)}
        />
      )}
    </>
  );
}
