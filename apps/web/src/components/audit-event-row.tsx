'use client';

import type { AuditEventListItem } from '@palouse/shared';
import { Badge } from '@palouse/ui';

/** Compact "time ago"; the full timestamp lives in the row's title attribute. */
export function timeAgo(iso: string): string {
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

export function fullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Human labels for the entity fields that appear in a change diff. */
const FIELD_LABELS: Record<string, string> = {
  title: 'title',
  name: 'name',
  descriptionMd: 'description',
  status: 'status',
  priority: 'priority',
  dueAt: 'due date',
  assigneeUserId: 'assignee',
  area: 'area',
  startDate: 'start date',
  targetDate: 'target date',
  supersededByDecisionId: 'superseded by',
};

function fieldLabel(field: string): string {
  return (
    FIELD_LABELS[field] ??
    field
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .toLowerCase()
  );
}

/** Render one before/after value. Empty values use the en-dash placeholder. */
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

type FieldChange = { from: unknown; to: unknown };

/** Pull the typed `changes` map out of the loosely-typed audit payload. */
function readChanges(payload: Record<string, unknown>): Array<[string, FieldChange]> {
  const raw = payload.changes;
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw as Record<string, FieldChange>).filter(
    ([, c]) => c && typeof c === 'object' && 'from' in c && 'to' in c,
  );
}

/**
 * One row of the activity feed, shared by the workspace-level feed and each
 * entity's Activity section. Shows who did what, a relative timestamp, and, for
 * updates, the changed fields with their old and new values.
 */
export function AuditEventRow({ event }: { event: AuditEventListItem }) {
  const changes = readChanges(event.payload);
  return (
    <div className="flex items-start gap-3 p-3 text-sm">
      <Badge
        variant={event.actorType === 'agent' ? 'secondary' : 'outline'}
        className="mt-0.5 shrink-0"
      >
        {event.actorType === 'agent' ? 'Agent' : 'Person'}
      </Badge>
      <div className="flex flex-1 flex-col gap-1">
        <span className="leading-snug">{event.summary}</span>
        {changes.length > 0 && (
          <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
            {changes.map(([field, change]) => (
              <li key={field}>
                <span className="font-medium">{fieldLabel(field)}:</span>{' '}
                <span className="line-through opacity-70">{formatValue(change.from)}</span>{' '}
                <span aria-hidden>→</span> <span>{formatValue(change.to)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <span className="text-muted-foreground shrink-0 tabular-nums" title={fullTimestamp(event.at)}>
        {timeAgo(event.at)}
      </span>
    </div>
  );
}
