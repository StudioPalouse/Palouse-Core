'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { HandoffListItem } from '@palouse/shared';
import { Badge, Button, Skeleton } from '@palouse/ui';
import { HandoffReviewActions } from '@/components/handoff-review-actions';
import { Markdown } from '@/components/markdown';
import { TasksTabs } from '@/components/tasks-tabs';
import { api } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { emitHandoffsChanged, formatDateTime } from '@/lib/handoff-meta';

const POLL_MS = 5_000;

export default function ReviewsPage() {
  return <ReviewsContent />;
}

function ReviewsContent() {
  const { workspace } = useActiveWorkspace();
  const [handoffs, setHandoffs] = useState<HandoffListItem[] | null>(null);

  const refresh = useCallback(() => {
    if (!workspace) return;
    api
      .listHandoffs(workspace.id, { state: 'needs_review' })
      .then(({ handoffs }) => setHandoffs(handoffs))
      .catch(() => {
        // Poll errors are transient; keep showing the last good list.
      });
  }, [workspace]);

  useEffect(refresh, [refresh]);

  // New review items should appear without a reload, like the other
  // handoff surfaces that poll.
  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const [bulkActing, setBulkActing] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  async function approveAll() {
    if (!workspace || !handoffs?.length) return;
    const n = handoffs.length;
    if (!window.confirm(`Approve all ${n} agent tasks waiting for review?`)) return;
    setBulkActing(true);
    setBulkError(null);
    const results = await Promise.allSettled(
      handoffs.map((h) => api.reviewHandoff(workspace.id, h.id, { decision: 'approved' })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      setBulkError(`${failed} of ${n} approvals didn't go through. The rest are approved.`);
    }
    emitHandoffsChanged();
    refresh();
    setBulkActing(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">
        Tasks
        {workspace && (
          <span className="text-muted-foreground ml-2 text-sm font-normal">{workspace.name}</span>
        )}
      </h1>

      <TasksTabs />

      {handoffs === null ? (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
        </div>
      ) : handoffs.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border p-8 text-center text-sm">
          Nothing needs your review. Agent tasks land here when they finish work you asked to check
          first.
        </p>
      ) : (
        <>
          {handoffs.length > 1 && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-muted-foreground text-sm">
                {handoffs.length} agent tasks are waiting for your review.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                disabled={bulkActing}
                onClick={() => void approveAll()}
              >
                {bulkActing ? 'Approving…' : `Approve all (${handoffs.length})`}
              </Button>
            </div>
          )}
          {bulkError && <p className="text-destructive text-sm">{bulkError}</p>}
          <ul className="flex flex-col gap-4">
            {handoffs.map((handoff) => (
              <li key={handoff.id} className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive">Needs your review</Badge>
                  <span className="text-sm font-medium">{handoff.taskTitle ?? 'Task'}</span>
                  <span className="text-muted-foreground ml-auto text-xs">
                    {handoff.agentName ?? 'Agent'} · {formatDateTime(handoff.updatedAt)}
                  </span>
                  <Link
                    href={{ pathname: `/handoffs/${handoff.id}` }}
                    className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
                  >
                    Activity report
                  </Link>
                </div>
                {handoff.resultSummaryMd && <Markdown>{handoff.resultSummaryMd}</Markdown>}
                {workspace && (
                  <HandoffReviewActions
                    workspaceId={workspace.id}
                    handoffId={handoff.id}
                    onReviewed={refresh}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
