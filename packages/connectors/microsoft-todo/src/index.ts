import type {
  ConnectorAdapter,
  NormalizedExternalTask,
  PullContext,
  PullResult,
  PushPayload,
  WebhookSubscription,
} from '@reqops/connector-core';
import {
  graphCreateSubscription,
  graphDateToIso,
  graphGetAll,
  graphRenewSubscription,
  graphSend,
  msBuildAuthUrl,
  msExchangeCode,
  msRefreshTokens,
  type GraphDateTimeTimeZone,
} from '@reqops/connector-microsoft-graph';
import type { TaskStatus } from '@reqops/shared';

export const PROVIDER = 'ms_todo' as const;

interface TodoList {
  id: string;
  displayName: string;
  wellknownListName?: string;
}

interface TodoTask {
  id: string;
  title?: string;
  status?: 'notStarted' | 'inProgress' | 'completed' | 'waitingOnOthers' | 'deferred';
  body?: { content?: string; contentType?: string };
  dueDateTime?: GraphDateTimeTimeZone;
  lastModifiedDateTime?: string;
  '@odata.etag'?: string;
}

function toStatus(s: TodoTask['status']): TaskStatus {
  if (s === 'completed') return 'done';
  if (s === 'inProgress') return 'in_progress';
  if (s === 'waitingOnOthers') return 'blocked';
  return 'open';
}

function fromStatus(s: TaskStatus): NonNullable<TodoTask['status']> {
  if (s === 'done') return 'completed';
  if (s === 'in_progress') return 'inProgress';
  if (s === 'blocked') return 'waitingOnOthers';
  return 'notStarted';
}

function normalize(listId: string, t: TodoTask): NormalizedExternalTask {
  return {
    externalSystem: 'ms_todo',
    // To Do task ids are scoped to a list — key on both (same scheme as google_tasks).
    externalId: `${listId}:${t.id}`,
    externalEtag: t['@odata.etag'],
    externalUpdatedAt: t.lastModifiedDateTime,
    title: t.title?.trim() || '(untitled)',
    descriptionMd: t.body?.content?.trim() || undefined,
    status: toStatus(t.status),
    dueAt: graphDateToIso(t.dueDateTime),
  };
}

export const microsoftTodoAdapter: ConnectorAdapter = {
  system: 'ms_todo',
  // Graph change notifications are the primary inbound path; polling is backfill.
  pollOnly: false,

  buildAuthUrl: msBuildAuthUrl,
  exchangeCode: msExchangeCode,
  refreshTokens: msRefreshTokens,

  async pull(ctx: PullContext): Promise<PullResult> {
    const lists = await graphGetAll<TodoList>('/me/todo/lists', ctx.accessToken);
    const tasks: NormalizedExternalTask[] = [];
    let maxModified = ctx.cursor;

    for (const list of lists) {
      let path = `/me/todo/lists/${list.id}/tasks`;
      if (ctx.cursor) {
        path += `?$filter=lastModifiedDateTime gt ${encodeURIComponent(ctx.cursor)}`;
      }
      const items = await graphGetAll<TodoTask>(path, ctx.accessToken);
      for (const t of items) {
        tasks.push(normalize(list.id, t));
        if (t.lastModifiedDateTime && (!maxModified || t.lastModifiedDateTime > maxModified)) {
          maxModified = t.lastModifiedDateTime;
        }
      }
    }
    return { tasks, nextCursor: maxModified };
  },

  async push(ctx: PullContext, payload: PushPayload): Promise<void> {
    const [listId, taskId] = payload.externalId.split(':');
    if (!listId || !taskId) throw new Error(`Bad ms_todo externalId: ${payload.externalId}`);
    const body: Record<string, unknown> = {};
    if (payload.title !== undefined) body.title = payload.title;
    if (payload.status !== undefined) body.status = fromStatus(payload.status);
    if (payload.descriptionMd !== undefined) {
      body.body = { content: payload.descriptionMd ?? '', contentType: 'text' };
    }
    if (payload.dueAt !== undefined) {
      body.dueDateTime = payload.dueAt
        ? { dateTime: payload.dueAt.replace(/Z$/, ''), timeZone: 'UTC' }
        : null;
    }
    await graphSend(`/me/todo/lists/${listId}/tasks/${taskId}`, ctx.accessToken, {
      method: 'PATCH',
      body,
    });
  },

  /** Subscribes to the default task list (Graph caps To Do subs at ~3 days). */
  async subscribeWebhook(ctx: PullContext, callbackUrl: string): Promise<WebhookSubscription> {
    const lists = await graphGetAll<TodoList>('/me/todo/lists', ctx.accessToken);
    const target = lists.find((l) => l.wellknownListName === 'defaultList') ?? lists[0];
    if (!target) throw new Error('Microsoft account has no To Do lists');
    return graphCreateSubscription({
      accessToken: ctx.accessToken,
      resource: `/me/todo/lists/${target.id}/tasks`,
      notificationUrl: callbackUrl,
      clientState: ctx.integrationId,
    });
  },

  async renewWebhook(ctx: PullContext, subscriptionId: string): Promise<WebhookSubscription> {
    return graphRenewSubscription(ctx.accessToken, subscriptionId);
  },
};
