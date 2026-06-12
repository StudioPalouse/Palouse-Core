'use client';

import { useCallback, useEffect, useState } from 'react';
import { isTerminal, type HandoffEvent, type HandoffListItem } from '@reqops/shared';
import { Badge, Button, Textarea } from '@reqops/ui';
import { api } from '@/lib/api';
import {
  formatDateTime,
  HANDOFF_STATE_BADGE,
  HANDOFF_STATE_LABELS,
} from '@/lib/handoff-meta';
import { AgentPickerDialog } from './agent-picker-dialog';
import { HandoffTimeline } from './handoff-timeline';

const POLL_MS = 5_000;

/** "Agent task" section of the task detail sheet: hand off, watch, review. */
export function HandoffPanel({ workspaceId, taskId }: { workspaceId: string; taskId: string }) {
  const [latest, setLatest] = useState<HandoffListItem | null | undefined>(undefined);
  const [events, setEvents] = useState<HandoffEvent[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [acting, setActing] = useState(false);

  const refresh = useCallback(async () => {
    const { handoffs } = await api.listHandoffs(workspaceId, { taskId });
    const current = handoffs[0] ?? null;
    setLatest(current);
    if (current) {
      const { events } = await api.getHandoff(workspaceId, current.id);
      setEvents(events);
    } else {
      setEvents([]);
    }
  }, [workspaceId, taskId]);

  useEffect(() => {
    setLatest(undefined);
    setEvents([]);
    void refresh();
  }, [refresh]);

  // Live-ish updates while an agent is on the task.
  useEffect(() => {
    if (!latest || isTerminal(latest.state)) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [latest, refresh]);

  async function act(fn: () => Promise<unknown>) {
    setActing(true);
    try {
      await fn();
      setReviewNote('');
      await refresh();
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-medium">Agent task</h3>
        <div className="ml-auto flex items-center gap-2">
          {latest && !isTerminal(latest.state) && latest.state !== 'needs_review' && (
            <Button
              variant="ghost"
              size="sm"
              disabled={acting}
              onClick={() => void act(() => api.cancelHandoff(workspaceId, latest.id))}
            >
              Cancel
            </Button>
          )}
          {(latest === null || (latest && isTerminal(latest.state))) && (
            <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
              Hand off to agent
            </Button>
          )}
        </div>
      </div>

      {latest === undefined ? null : latest === null ? (
        <p className="text-muted-foreground text-sm">
          This task hasn&apos;t been handed to an agent.
        </p>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={HANDOFF_STATE_BADGE[latest.state]}>
              {HANDOFF_STATE_LABELS[latest.state]}
            </Badge>
            <span className="text-muted-foreground text-xs">
              {latest.agentName ?? 'Agent'} · handed off {formatDateTime(latest.createdAt)}
            </span>
          </div>

          {latest.resultSummaryMd && (
            <p className="text-sm whitespace-pre-wrap">{latest.resultSummaryMd}</p>
          )}
          {latest.failureReason && (
            <p className="text-destructive text-sm">{latest.failureReason}</p>
          )}

          {latest.state === 'needs_review' && (
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <p className="text-sm font-medium">Review the agent&apos;s work</p>
              <Textarea
                rows={2}
                placeholder="Optional note for the record (required context if sending back)…"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={acting}
                  onClick={() =>
                    void act(() =>
                      api.reviewHandoff(workspaceId, latest.id, {
                        decision: 'rejected',
                        note: reviewNote.trim() || undefined,
                        rejectAction: 'retry',
                      }),
                    )
                  }
                >
                  Send back
                </Button>
                <Button
                  size="sm"
                  disabled={acting}
                  onClick={() =>
                    void act(() =>
                      api.reviewHandoff(workspaceId, latest.id, {
                        decision: 'approved',
                        note: reviewNote.trim() || undefined,
                      }),
                    )
                  }
                >
                  Approve
                </Button>
              </div>
            </div>
          )}

          <HandoffTimeline events={events} />
        </div>
      )}

      <AgentPickerDialog
        workspaceId={workspaceId}
        taskId={taskId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onHandedOff={() => void refresh()}
      />
    </div>
  );
}
