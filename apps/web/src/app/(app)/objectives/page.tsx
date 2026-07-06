'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ObjectiveListItem } from '@palouse/shared';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@palouse/ui';
import { ObjectiveList } from '@/components/objective-list';
import { ObjectiveDetailSheet } from '@/components/objective-detail-sheet';
import { NewObjectiveDialog } from '@/components/new-objective-dialog';
import { api } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { OBJECTIVE_STATUS_LABELS, OBJECTIVE_STATUS_ORDER } from '@/lib/objective-meta';

const POLL_MS = 20_000;

export default function ObjectivesPage() {
  const { workspace } = useActiveWorkspace();
  const [objectives, setObjectives] = useState<ObjectiveListItem[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!workspace) return;
    const params: { status?: string; search?: string; limit?: number } = { limit: 200 };
    if (statusFilter !== 'all') params.status = statusFilter;
    if (search.trim()) params.search = search.trim();
    api.listObjectives(workspace.id, params).then(({ objectives }) => setObjectives(objectives));
  }, [workspace, statusFilter, search]);

  useEffect(() => {
    const t = setTimeout(refresh, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [refresh, search]);

  // Agents can create or update objectives server-side with nothing to signal
  // the client, so the list polls to pick up their changes.
  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <>
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">
          Objectives
          {workspace && (
            <span className="text-muted-foreground ml-2 text-sm font-normal">{workspace.name}</span>
          )}
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search objectives…"
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
              {OBJECTIVE_STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {OBJECTIVE_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto">
            {workspace && <NewObjectiveDialog workspaceId={workspace.id} onCreated={refresh} />}
          </div>
        </div>

        <div className="rounded-lg border">
          {objectives === null ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-5/6" />
              <Skeleton className="h-5 w-4/6" />
            </div>
          ) : objectives.length === 0 ? (
            <p className="text-muted-foreground p-8 text-center text-sm">
              No objectives yet. Set a goal your team is working toward.
            </p>
          ) : (
            <ObjectiveList objectives={objectives} onSelect={setSelectedId} />
          )}
        </div>
      </div>

      {workspace && (
        <ObjectiveDetailSheet
          workspaceId={workspace.id}
          objectiveId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}
