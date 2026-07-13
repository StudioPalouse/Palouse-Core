'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuditEventListItem } from '@palouse/shared';
import { Skeleton } from '@palouse/ui';
import { api } from '@/lib/api';
import { AuditEventRow } from './audit-event-row';

/**
 * The Activity section on an entity's detail view (roadmap D2). Shows every
 * audited action on this one record, human and agent, newest first, with the
 * before/after values for updates. Scoped to the record via the query API's
 * `targetType` + `targetId` filter; agent `mcp.*` rows target the agent, not the
 * entity, so they never appear here. Read-only; the `audit` capability gates the
 * nav-level feed, but per-entity history rides along with the entity view.
 */
export function EntityActivity({
  workspaceId,
  targetType,
  targetId,
}: {
  workspaceId: string;
  targetType: 'task' | 'decision' | 'objective' | 'project';
  targetId: string;
}) {
  const [events, setEvents] = useState<AuditEventListItem[] | null>(null);

  const load = useCallback(() => {
    api
      .listAuditEvents(workspaceId, { targetType, targetId, limit: 100 })
      .then(({ events }) => setEvents(events))
      .catch(() => setEvents([]));
  }, [workspaceId, targetType, targetId]);

  useEffect(() => {
    setEvents(null);
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Activity</h3>
      {events === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : events.length === 0 ? (
        <p className="text-muted-foreground text-sm">No activity recorded yet.</p>
      ) : (
        <div className="divide-y rounded-md border">
          {events.map((event) => (
            <AuditEventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
