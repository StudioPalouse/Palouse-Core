'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, KanbanSquare, GanttChartSquare } from 'lucide-react';
import type { ProjectColumn, ProjectDetail, ProjectStatus } from '@palouse/shared';
import {
  Button,
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@palouse/ui';
import { ProjectBoard } from '@/components/project-board';
import { ProjectGantt } from '@/components/project-gantt';
import { ProjectItemDetailSheet } from '@/components/project-item-detail-sheet';
import { api, ApiError } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_ORDER } from '@/lib/project-meta';

const POLL_MS = 20_000;
type View = 'board' | 'timeline';

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const router = useRouter();
  const { workspace } = useActiveWorkspace();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [view, setView] = useState<View>('board');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspace) return;
    try {
      const data = await api.getProject(workspace.id, projectId);
      setDetail(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the project.');
    }
  }, [workspace, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Agents can change the board server-side, so poll to reflect their edits.
  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Something went wrong');
      }
    },
    [refresh],
  );

  if (!workspace) return null;
  const wsId = workspace.id;

  if (!detail) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/projects')}>
          <ArrowLeft className="size-4" />
          Projects
        </Button>
        <h1 className="text-lg font-semibold tracking-tight">{detail.project.name}</h1>
        <Select
          value={detail.project.status}
          onValueChange={(v) =>
            void run(() => api.updateProject(wsId, projectId, { status: v as ProjectStatus }))
          }
        >
          <SelectTrigger size="sm" variant="ghost">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROJECT_STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {PROJECT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1 rounded-md border p-0.5">
          <ViewButton active={view === 'board'} onClick={() => setView('board')} icon={KanbanSquare}>
            Board
          </ViewButton>
          <ViewButton
            active={view === 'timeline'}
            onClick={() => setView('timeline')}
            icon={GanttChartSquare}
          >
            Timeline
          </ViewButton>
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {view === 'board' ? (
        <ProjectBoard
          detail={detail}
          onSelectItem={setSelectedItemId}
          onMoveItem={(itemId, columnId, position) =>
            void run(() => api.updateProjectItem(wsId, projectId, itemId, { columnId, position }))
          }
          onAddItem={(columnId, title) =>
            void run(() => api.createProjectItem(wsId, projectId, { columnId, title }))
          }
          onAddColumn={(name) => void run(() => api.addProjectColumn(wsId, projectId, { name }))}
          onRenameColumn={(columnId, name) =>
            void run(() => api.updateProjectColumn(wsId, projectId, columnId, { name }))
          }
          onToggleDoneColumn={(column: ProjectColumn) =>
            void run(() =>
              api.updateProjectColumn(wsId, projectId, column.id, { isDone: !column.isDone }),
            )
          }
          onDeleteColumn={(columnId) =>
            void run(() => api.removeProjectColumn(wsId, projectId, columnId))
          }
        />
      ) : (
        <ProjectGantt detail={detail} />
      )}

      <ProjectItemDetailSheet
        workspaceId={wsId}
        projectId={projectId}
        detail={detail}
        itemId={selectedItemId}
        onClose={() => setSelectedItemId(null)}
        onChanged={refresh}
      />
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded px-2.5 py-1 text-sm transition-colors',
        active ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-4" />
      {children}
    </button>
  );
}
