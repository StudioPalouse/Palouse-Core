'use client';

import type { HandoffEvent, HandoffStep } from '@palouse/shared';
import { cn } from '@palouse/ui';
import { EVENT_LABELS, formatDateTime } from '@/lib/handoff-meta';

function eventDetail(event: HandoffEvent): string | null {
  const { kind, payload } = event;
  if (kind === 'reviewed') {
    const decision = payload.decision === 'approved' ? 'Approved' : 'Sent back';
    const note = typeof payload.note === 'string' && payload.note ? ` — ${payload.note}` : '';
    return `${decision}${note}`;
  }
  if ((kind === 'failed' || kind === 'requeued' || kind === 'cancelled') && payload.reason) {
    return String(payload.reason);
  }
  return null;
}

interface TimelineItem {
  id: string;
  at: string;
  label: string;
  detail: string | null;
  isStep: boolean;
  failed: boolean;
}

/**
 * One chronological story: lifecycle events interleaved with the plain-English
 * steps the agent logged via log_step — the explainability spine of the UX.
 */
export function HandoffTimeline({
  events,
  steps = [],
}: {
  events: HandoffEvent[];
  steps?: HandoffStep[];
}) {
  const items: TimelineItem[] = [
    ...events.map((event) => ({
      id: event.id,
      at: event.at,
      label: EVENT_LABELS[event.kind] ?? event.kind,
      detail: eventDetail(event),
      isStep: false,
      failed: event.kind === 'failed',
    })),
    ...steps.map((step) => ({
      id: step.id,
      at: step.createdAt,
      label: step.title,
      detail: step.detailMd,
      isStep: true,
      failed: step.status === 'failed',
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">No activity yet.</p>;
  }
  return (
    <ol className="flex flex-col">
      {items.map((item, i) => (
        <li key={item.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                'bg-border mt-1.5 size-2 shrink-0 rounded-full',
                item.isStep && 'bg-primary/40',
                i === items.length - 1 && 'bg-foreground',
                item.failed && 'bg-destructive',
              )}
            />
            {i < items.length - 1 && <span className="bg-border w-px flex-1" />}
          </div>
          <div className="flex-1 pb-4">
            <p className={cn('text-sm', item.isStep && 'text-muted-foreground')}>
              {item.label}
              {item.failed && item.isStep ? ' — failed' : ''}
            </p>
            {item.detail && (
              <p className="text-muted-foreground text-xs whitespace-pre-wrap">{item.detail}</p>
            )}
            <p className="text-muted-foreground text-xs">{formatDateTime(item.at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
