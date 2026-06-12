'use client';

import type { HandoffEvent } from '@reqops/shared';
import { cn } from '@reqops/ui';
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

export function HandoffTimeline({ events }: { events: HandoffEvent[] }) {
  if (events.length === 0) {
    return <p className="text-muted-foreground text-sm">No activity yet.</p>;
  }
  return (
    <ol className="flex flex-col">
      {events.map((event, i) => {
        const detail = eventDetail(event);
        return (
          <li key={event.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'bg-border mt-1.5 size-2 shrink-0 rounded-full',
                  i === events.length - 1 && 'bg-foreground',
                )}
              />
              {i < events.length - 1 && <span className="bg-border w-px flex-1" />}
            </div>
            <div className="flex-1 pb-4">
              <p className="text-sm">{EVENT_LABELS[event.kind] ?? event.kind}</p>
              {detail && <p className="text-muted-foreground text-xs">{detail}</p>}
              <p className="text-muted-foreground text-xs">{formatDateTime(event.at)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
