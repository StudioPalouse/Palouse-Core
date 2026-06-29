'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { HandoffListItem, Workspace } from '@palouse/shared';
import { Badge, Button, Skeleton, Textarea } from '@palouse/ui';
import { AppShell } from '@/components/app-shell';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/handoff-meta';

export default function ReviewsPage() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [handoffs, setHandoffs] = useState<HandoffListItem[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    api
      .listWorkspaces()
      .then(({ workspaces }) => {
        if (workspaces.length === 0) {
          router.replace('/workspaces/new');
          return;
        }
        setWorkspace(workspaces[0]!);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/sign-in');
      });
  }, [router]);

  const refresh = useCallback(() => {
    if (!workspace) return;
    api
      .listHandoffs(workspace.id, { state: 'needs_review' })
      .then(({ handoffs }) => setHandoffs(handoffs));
  }, [workspace]);

  useEffect(refresh, [refresh]);

  async function review(handoffId: string, decision: 'approved' | 'rejected') {
    if (!workspace) return;
    setActingId(handoffId);
    try {
      await api.reviewHandoff(workspace.id, handoffId, {
        decision,
        note: notes[handoffId]?.trim() || undefined,
        ...(decision === 'rejected' ? { rejectAction: 'retry' as const } : {}),
      });
      setNotes((n) => ({ ...n, [handoffId]: '' }));
      refresh();
    } finally {
      setActingId(null);
    }
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">
          Reviews
          {workspace && (
            <span className="text-muted-foreground ml-2 text-sm font-normal">{workspace.name}</span>
          )}
        </h1>

        {handoffs === null ? (
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
          </div>
        ) : handoffs.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border p-8 text-center text-sm">
            Nothing needs your review. Agent tasks land here when they finish work you asked to
            check first.
          </p>
        ) : (
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
                {handoff.resultSummaryMd && (
                  <p className="text-sm whitespace-pre-wrap">{handoff.resultSummaryMd}</p>
                )}
                <Textarea
                  rows={2}
                  placeholder="Optional note for the record…"
                  value={notes[handoff.id] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [handoff.id]: e.target.value }))}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actingId === handoff.id}
                    onClick={() => void review(handoff.id, 'rejected')}
                  >
                    Send back
                  </Button>
                  <Button
                    size="sm"
                    disabled={actingId === handoff.id}
                    onClick={() => void review(handoff.id, 'approved')}
                  >
                    Approve
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
