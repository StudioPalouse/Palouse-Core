'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { isTerminal } from '@reqops/shared';
import { Badge, Button, Separator, Skeleton, Textarea } from '@reqops/ui';
import { AppShell } from '@/components/app-shell';
import { HandoffTimeline } from '@/components/handoff-timeline';
import { UsageSummaryCards } from '@/components/usage-summary-cards';
import { api, ApiError } from '@/lib/api';
import {
  formatDateTime,
  formatUsd,
  HANDOFF_STATE_BADGE,
  HANDOFF_STATE_LABELS,
} from '@/lib/handoff-meta';

const POLL_MS = 5_000;

type HandoffDetail = Awaited<ReturnType<typeof api.getHandoff>>;

function durationLabel(detail: HandoffDetail): string | null {
  const { handoff } = detail;
  if (!handoff.claimedAt) return null;
  const end = isTerminal(handoff.state) || handoff.state === 'needs_review'
    ? new Date(handoff.updatedAt).getTime()
    : Date.now();
  const minutes = Math.max(0, Math.round((end - new Date(handoff.claimedAt).getTime()) / 60_000));
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Activity Report: the auditor-facing, plain-English account of what an
 * agent did on a task — narrative, cost/usage summary, step timeline, and
 * the per-call generation ledger.
 */
export default function ActivityReportPage() {
  const router = useRouter();
  const { handoffId } = useParams<{ handoffId: string }>();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HandoffDetail | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [acting, setActing] = useState(false);

  useEffect(() => {
    api
      .listWorkspaces()
      .then(({ workspaces }) => {
        if (workspaces.length === 0) router.replace('/workspaces/new');
        else setWorkspaceId(workspaces[0]!.id);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/sign-in');
      });
  }, [router]);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setDetail(await api.getHandoff(workspaceId, handoffId));
  }, [workspaceId, handoffId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!detail || isTerminal(detail.handoff.state)) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [detail, refresh]);

  async function review(decision: 'approved' | 'rejected') {
    if (!workspaceId || !detail) return;
    setActing(true);
    try {
      await api.reviewHandoff(workspaceId, detail.handoff.id, {
        decision,
        note: reviewNote.trim() || undefined,
        ...(decision === 'rejected' ? { rejectAction: 'retry' as const } : {}),
      });
      setReviewNote('');
      await refresh();
    } finally {
      setActing(false);
    }
  }

  return (
    <AppShell>
      {!detail ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">Agent activity report</h1>
              <Badge variant={HANDOFF_STATE_BADGE[detail.handoff.state]}>
                {HANDOFF_STATE_LABELS[detail.handoff.state]}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {detail.taskTitle ?? 'Task'} · {detail.agentName ?? 'Agent'} · handed off{' '}
              {formatDateTime(detail.handoff.createdAt)}
            </p>
          </div>

          {/* Narrative headline — same string the PDF/CSV exports will carry. */}
          <p className="rounded-lg border p-4 text-sm leading-relaxed">
            {detail.narrative.headline}
          </p>

          <UsageSummaryCards summary={detail.summary} durationLabel={durationLabel(detail)} />

          {detail.handoff.state === 'needs_review' && (
            <div className="flex flex-col gap-2 rounded-lg border p-4">
              <p className="text-sm font-medium">Review the agent&apos;s work</p>
              {detail.handoff.resultSummaryMd && (
                <p className="text-sm whitespace-pre-wrap">{detail.handoff.resultSummaryMd}</p>
              )}
              <Textarea
                rows={2}
                placeholder="Optional note for the record…"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" disabled={acting} onClick={() => void review('rejected')}>
                  Send back
                </Button>
                <Button size="sm" disabled={acting} onClick={() => void review('approved')}>
                  Approve
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">What happened</h2>
            <HandoffTimeline events={detail.events} steps={detail.steps} />
          </div>

          {detail.generations.length > 0 && (
            <>
              <Separator />
              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-medium">Model usage</h2>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground border-b text-left text-xs">
                        <th className="px-3 py-2 font-medium">When</th>
                        <th className="px-3 py-2 font-medium">Model</th>
                        <th className="px-3 py-2 text-right font-medium">Tokens in</th>
                        <th className="px-3 py-2 text-right font-medium">Tokens out</th>
                        <th className="px-3 py-2 text-right font-medium">Cost</th>
                        <th className="px-3 py-2 font-medium">Priced by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.generations.map((g) => (
                        <tr key={g.id} className="border-b last:border-0">
                          <td className="text-muted-foreground px-3 py-2 text-xs">
                            {formatDateTime(g.occurredAt)}
                          </td>
                          <td className="px-3 py-2">{g.model}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {g.inputTokens.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {g.outputTokens.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {g.costUsd === null ? (
                              <Badge variant="outline">Unpriced</Badge>
                            ) : (
                              formatUsd(g.costUsd)
                            )}
                          </td>
                          <td className="text-muted-foreground px-3 py-2 text-xs">
                            {g.priceSource === 'workspace_override'
                              ? 'Workspace rate'
                              : g.priceSource === 'catalog'
                                ? `Catalog ${g.priceSnapshot?.catalogVersion ?? ''}`
                                : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-muted-foreground text-xs">
                  Costs are computed by ReqOps from its model price catalog at the moment of
                  ingest and stay reproducible — each row stores the exact rates used.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
