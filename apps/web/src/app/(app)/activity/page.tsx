'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuditEventListItem } from '@palouse/shared';
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
import { EmptyState } from '@/components/fieldwork/empty-state';
import { api } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace-context';

const POLL_MS = 20_000;

const TARGET_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All items' },
  { value: 'task', label: 'Tasks' },
  { value: 'decision', label: 'Decisions' },
  { value: 'objective', label: 'Objectives' },
  { value: 'project', label: 'Projects' },
  { value: 'agent', label: 'Agents' },
];

/** Compact "time ago"; the full timestamp lives in the row's title attribute. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ActivityPage() {
  const { workspace } = useActiveWorkspace();
  const [events, setEvents] = useState<AuditEventListItem[] | null>(null);
  const [actorFilter, setActorFilter] = useState<string>('all');
  const [targetFilter, setTargetFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const refresh = useCallback(() => {
    if (!workspace) return;
    const params: {
      actorType?: 'user' | 'agent';
      targetType?: string;
      search?: string;
      limit?: number;
    } = { limit: 200 };
    if (actorFilter !== 'all') params.actorType = actorFilter as 'user' | 'agent';
    if (targetFilter !== 'all') params.targetType = targetFilter;
    if (search.trim()) params.search = search.trim();
    api.listAuditEvents(workspace.id, params).then(({ events }) => setEvents(events));
  }, [workspace, actorFilter, targetFilter, search]);

  useEffect(() => {
    const t = setTimeout(refresh, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [refresh, search]);

  // Agents act server-side with nothing to signal the client, so the feed polls.
  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">
        Activity
        {workspace && (
          <span className="text-muted-foreground ml-2 text-sm font-normal">{workspace.name}</span>
        )}
      </h1>

      <p className="text-muted-foreground max-w-2xl text-sm">
        Everything people and agents did to your tasks, decisions, objectives, and projects, newest
        first.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search activity…"
          className="h-8 w-48"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={actorFilter} onValueChange={setActorFilter}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            <SelectItem value="user">People</SelectItem>
            <SelectItem value="agent">Agents</SelectItem>
          </SelectContent>
        </Select>
        <Select value={targetFilter} onValueChange={setTargetFilter}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TARGET_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border">
        {events === null ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
            <Skeleton className="h-5 w-4/6" />
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            bordered={false}
            title="No activity yet"
            description="As people and agents work on tasks, decisions, objectives, and projects, what they do shows up here."
          />
        ) : (
          <div className="divide-y">
            {events.map((event) => (
              <div key={event.id} className="flex items-start gap-3 p-3 text-sm">
                <Badge
                  variant={event.actorType === 'agent' ? 'secondary' : 'outline'}
                  className="mt-0.5 shrink-0"
                >
                  {event.actorType === 'agent' ? 'Agent' : 'Person'}
                </Badge>
                <span className="flex-1 leading-snug">{event.summary}</span>
                <span
                  className="text-muted-foreground shrink-0 tabular-nums"
                  title={fullTimestamp(event.at)}
                >
                  {timeAgo(event.at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
