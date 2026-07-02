// Unified "Microsoft Tasks" connector: one Graph OAuth consent surfaces both
// To Do and Planner tasks. Both products sit behind the same delegated
// Tasks.ReadWrite scope, so a single token serves the two underlying adapters.
// Pulled tasks keep per-product provenance (externalSystem ms_todo/ms_planner)
// and pushes route back on that same field.
import {
  ConnectorHttpError,
  type ConnectorAdapter,
  type PullContext,
  type PullResult,
  type PushPayload,
  type WebhookSubscription,
} from '@palouse/connector-core';
import {
  msBuildAuthUrl,
  msExchangeCode,
  msRefreshTokens,
} from '@palouse/connector-microsoft-graph';
import { microsoftPlannerAdapter } from '@palouse/connector-microsoft-planner';
import { microsoftTodoAdapter } from '@palouse/connector-microsoft-todo';

export const PROVIDER = 'ms_tasks' as const;

export const microsoftTasksAdapter: ConnectorAdapter = {
  // Informational only — the pipeline reads each pulled task's own
  // externalSystem, which this adapter stamps ms_todo or ms_planner per source.
  system: 'ms_todo',
  // The To Do half gets Graph change notifications; Planner has none, so the
  // poll cadence is Planner's (see POLL_INTERVAL_MS) with To Do riding along.
  pollOnly: false,

  buildAuthUrl: msBuildAuthUrl,
  exchangeCode: msExchangeCode,
  refreshTokens: msRefreshTokens,

  /**
   * Pulls To Do (incremental via the shared cursor) then Planner (always a
   * full snapshot; it keeps no cursor, so the To Do cursor is the only one).
   * Personal Microsoft accounts have no Planner — Graph rejects
   * /me/planner/tasks with a 4xx there — so Planner failures on a working
   * To Do pull degrade to a To Do-only sync instead of failing the connection.
   */
  async pull(ctx: PullContext): Promise<PullResult> {
    const todo = await microsoftTodoAdapter.pull(ctx);
    let plannerTasks: PullResult['tasks'] = [];
    try {
      const planner = await microsoftPlannerAdapter.pull({ ...ctx, cursor: undefined });
      plannerTasks = planner.tasks;
    } catch (err) {
      const notAvailable =
        err instanceof ConnectorHttpError && err.status >= 400 && err.status < 500;
      if (!notAvailable) throw err;
    }
    return { tasks: [...todo.tasks, ...plannerTasks], nextCursor: todo.nextCursor };
  },

  async push(ctx: PullContext, payload: PushPayload): Promise<void> {
    // task_sources provenance picks the product; the externalId shape is the
    // fallback (To Do ids are "listId:taskId", Planner ids never contain ':').
    const isTodo =
      payload.externalSystem === 'ms_todo' ||
      (payload.externalSystem === undefined && payload.externalId.includes(':'));
    const adapter = isTodo ? microsoftTodoAdapter : microsoftPlannerAdapter;
    if (!adapter.push) return;
    await adapter.push(ctx, payload);
  },

  async subscribeWebhook(ctx: PullContext, callbackUrl: string): Promise<WebhookSubscription> {
    if (!microsoftTodoAdapter.subscribeWebhook) throw new Error('To Do adapter has no webhook');
    return microsoftTodoAdapter.subscribeWebhook(ctx, callbackUrl);
  },

  async renewWebhook(ctx: PullContext, subscriptionId: string): Promise<WebhookSubscription> {
    if (!microsoftTodoAdapter.renewWebhook) throw new Error('To Do adapter has no webhook');
    return microsoftTodoAdapter.renewWebhook(ctx, subscriptionId);
  },
};
