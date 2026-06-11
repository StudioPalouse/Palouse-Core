import type {
  ConnectorAdapter,
  NormalizedExternalTask,
  PullContext,
  PullResult,
  PushPayload,
} from '@reqops/connector-core';
import {
  graphDateToIso,
  graphGet,
  graphGetAll,
  graphSend,
  msBuildAuthUrl,
  msExchangeCode,
  msRefreshTokens,
} from '@reqops/connector-microsoft-graph';
import type { TaskStatus } from '@reqops/shared';

export const PROVIDER = 'ms_planner' as const;

interface PlannerTask {
  id: string;
  title?: string;
  percentComplete?: number;
  dueDateTime?: string | null;
  createdDateTime?: string;
  '@odata.etag'?: string;
}

function toStatus(percent: number | undefined): TaskStatus {
  if (percent === 100) return 'done';
  if (percent && percent > 0) return 'in_progress';
  return 'open';
}

// Planner only models not-started / in-progress / complete.
function toPercent(s: TaskStatus): number {
  if (s === 'done') return 100;
  if (s === 'in_progress' || s === 'blocked') return 50;
  return 0;
}

function normalize(t: PlannerTask): NormalizedExternalTask {
  return {
    externalSystem: 'ms_planner',
    externalId: t.id,
    externalEtag: t['@odata.etag'],
    title: t.title?.trim() || '(untitled)',
    // Description lives in /planner/tasks/{id}/details (a fetch per task) — v1
    // syncs the core fields only.
    status: toStatus(t.percentComplete),
    dueAt: t.dueDateTime ? graphDateToIso({ dateTime: t.dueDateTime.replace(/Z$/, '') }) : undefined,
  };
}

export const microsoftPlannerAdapter: ConnectorAdapter = {
  system: 'ms_planner',
  // Graph change notifications don't cover Planner resources — poll only.
  pollOnly: true,

  buildAuthUrl: msBuildAuthUrl,
  exchangeCode: msExchangeCode,
  refreshTokens: msRefreshTokens,

  /**
   * Pulls every Planner task assigned to the connected user. plannerTask has no
   * modified-time filter, so each pull is a full snapshot (the sync-key upsert
   * keeps it idempotent) and no cursor is kept.
   */
  async pull(ctx: PullContext): Promise<PullResult> {
    const items = await graphGetAll<PlannerTask>('/me/planner/tasks', ctx.accessToken);
    return { tasks: items.map(normalize) };
  },

  async push(ctx: PullContext, payload: PushPayload): Promise<void> {
    // Planner PATCHes require a fresh If-Match etag.
    const current = await graphGet<PlannerTask>(
      `/planner/tasks/${payload.externalId}`,
      ctx.accessToken,
    );
    const etag = current['@odata.etag'];
    if (!etag) throw new Error(`Planner task ${payload.externalId} returned no etag`);

    const body: Record<string, unknown> = {};
    if (payload.title !== undefined) body.title = payload.title;
    if (payload.status !== undefined) body.percentComplete = toPercent(payload.status);
    if (payload.dueAt !== undefined) body.dueDateTime = payload.dueAt;
    if (Object.keys(body).length === 0) return;

    await graphSend(`/planner/tasks/${payload.externalId}`, ctx.accessToken, {
      method: 'PATCH',
      body,
      etag,
    });
  },
};
