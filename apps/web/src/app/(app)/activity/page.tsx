'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AuditEventListItem, AuditVerifyResult } from '@palouse/shared';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@palouse/ui';
import { AuditEventRow } from '@/components/audit-event-row';
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

/**
 * Tamper-evidence badge. The record is hash-chained; this shows whether a fresh
 * re-walk of the chain matches, so a business user can trust the timeline has
 * not been altered. Read-only surface over GET /v1/audit/verify.
 */
function IntegrityBadge({ result }: { result: AuditVerifyResult | null }) {
  if (result === null) {
    return <span className="text-muted-foreground text-xs">Checking integrity…</span>;
  }
  if (!result.valid) {
    return (
      <span
        className="text-destructive inline-flex items-center gap-1 text-xs font-medium"
        title={
          result.firstBrokenSeq != null
            ? `Chain verification failed at entry #${result.firstBrokenSeq}.`
            : 'Chain verification failed.'
        }
      >
        <ShieldAlert className="size-3.5" />
        Integrity check failed
      </span>
    );
  }
  const title =
    `Verified ${result.checkedCount} chained entries.` +
    (result.unchainedCount > 0 ? ` ${result.unchainedCount} awaiting backfill.` : '');
  return (
    <span
      className="text-status-done inline-flex items-center gap-1 text-xs font-medium"
      title={title}
    >
      <ShieldCheck className="size-3.5" />
      Integrity verified
    </span>
  );
}

export default function ActivityPage() {
  const { workspace } = useActiveWorkspace();
  const [events, setEvents] = useState<AuditEventListItem[] | null>(null);
  const [integrity, setIntegrity] = useState<AuditVerifyResult | null>(null);
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

  // Verifying re-walks the whole chain, so run it on workspace change (and once
  // per feed poll), not on every filter keystroke.
  useEffect(() => {
    if (!workspace) return;
    setIntegrity(null);
    let cancelled = false;
    const run = () =>
      api
        .verifyAudit(workspace.id)
        .then((r) => !cancelled && setIntegrity(r))
        .catch(() => !cancelled && setIntegrity(null));
    run();
    const t = setInterval(run, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [workspace]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">
          Activity
          {workspace && (
            <span className="text-muted-foreground ml-2 text-sm font-normal">{workspace.name}</span>
          )}
        </h1>
        <IntegrityBadge result={integrity} />
      </div>

      <p className="text-muted-foreground max-w-2xl text-sm">
        Everything people and agents did to your tasks, decisions, objectives, and projects, newest
        first. Every entry is hash-chained, so the record is tamper-evident.
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
              <AuditEventRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
