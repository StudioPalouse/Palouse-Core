'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DecisionListItem } from '@palouse/shared';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@palouse/ui';
import { DecisionList } from '@/components/decision-list';
import { EmptyState } from '@/components/fieldwork/empty-state';
import { DecisionDetailSheet } from '@/components/decision-detail-sheet';
import { NewDecisionDialog } from '@/components/new-decision-dialog';
import { api } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { DECISION_STATUS_LABELS, DECISION_STATUS_ORDER } from '@/lib/decision-meta';

const POLL_MS = 20_000;

export default function DecisionsPage() {
  const { workspace } = useActiveWorkspace();
  const [decisions, setDecisions] = useState<DecisionListItem[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!workspace) return;
    const params: { status?: string; search?: string; limit?: number } = { limit: 200 };
    if (statusFilter !== 'all') params.status = statusFilter;
    if (search.trim()) params.search = search.trim();
    api.listDecisions(workspace.id, params).then(({ decisions }) => setDecisions(decisions));
  }, [workspace, statusFilter, search]);

  useEffect(() => {
    const t = setTimeout(refresh, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [refresh, search]);

  // Agents can create or update decisions server-side with nothing to signal
  // the client, so the list polls to pick up their changes.
  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <>
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">
          Decisions
          {workspace && (
            <span className="text-muted-foreground ml-2 text-sm font-normal">{workspace.name}</span>
          )}
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search decisions…"
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
              {DECISION_STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {DECISION_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto">
            {workspace && <NewDecisionDialog workspaceId={workspace.id} onCreated={refresh} />}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border">
          {decisions === null ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-5/6" />
              <Skeleton className="h-5 w-4/6" />
            </div>
          ) : decisions.length === 0 ? (
            <EmptyState
              bordered={false}
              title="No decisions yet"
              description="Log one to start your team&rsquo;s decision record."
            />
          ) : (
            <DecisionList decisions={decisions} onSelect={setSelectedId} />
          )}
        </div>
      </div>

      {workspace && (
        <DecisionDetailSheet
          workspaceId={workspace.id}
          decisionId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}
