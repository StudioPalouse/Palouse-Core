'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ProjectListItem } from '@palouse/shared';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@palouse/ui';
import { ProjectList } from '@/components/project-list';
import { EmptyState } from '@/components/fieldwork/empty-state';
import { NewProjectDialog } from '@/components/new-project-dialog';
import { api } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_ORDER } from '@/lib/project-meta';

const POLL_MS = 20_000;

export default function ProjectsPage() {
  const { workspace } = useActiveWorkspace();
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const refresh = useCallback(() => {
    if (!workspace) return;
    const params: { status?: string; search?: string; limit?: number } = { limit: 200 };
    if (statusFilter !== 'all') params.status = statusFilter;
    if (search.trim()) params.search = search.trim();
    api.listProjects(workspace.id, params).then(({ projects }) => setProjects(projects));
  }, [workspace, statusFilter, search]);

  useEffect(() => {
    const t = setTimeout(refresh, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [refresh, search]);

  // Agents can create or update projects server-side with nothing to signal the
  // client, so the list polls to pick up their changes.
  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">
        Projects
        {workspace && (
          <span className="text-muted-foreground ml-2 text-sm font-normal">{workspace.name}</span>
        )}
      </h1>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search projects…"
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
            {PROJECT_STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {PROJECT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          {workspace && <NewProjectDialog workspaceId={workspace.id} onCreated={refresh} />}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        {projects === null ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
            <Skeleton className="h-5 w-4/6" />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            bordered={false}
            title="No projects yet"
            description="Start a board to organize related work."
          />
        ) : (
          <ProjectList projects={projects} />
        )}
      </div>
    </div>
  );
}
