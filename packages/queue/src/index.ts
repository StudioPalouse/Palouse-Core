import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const QUEUE_NAMES = {
  sync: 'sync',
  handoff: 'handoff',
  notifications: 'notifications',
  audit: 'audit',
  housekeeping: 'housekeeping',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const SYNC_JOBS = {
  pullIntegration: 'sync.pull_integration',
  processWebhook: 'sync.process_webhook',
  pushTask: 'sync.push_task',
  renewSubscriptions: 'sync.renew_subscriptions',
} as const;

export interface SyncPullJob {
  integrationId: string;
}

export interface SyncProcessWebhookJob {
  integrationId: string;
  deliveryId: string;
}

export interface SyncPushJob {
  taskId: string;
  workspaceId: string;
}

/** Workspace-wide sweep — carries no payload. */
export type SyncRenewSubscriptionsJob = Record<string, never>;

export type SyncJobData =
  | SyncPullJob
  | SyncProcessWebhookJob
  | SyncPushJob
  | SyncRenewSubscriptionsJob;

export const HANDOFF_JOBS = {
  reapExpired: 'handoff.reap_expired',
  notifyAgent: 'handoff.notify_agent',
} as const;

/** Sweep carries no payload. */
export type HandoffReapJob = Record<string, never>;

export interface HandoffNotifyJob {
  handoffId: string;
  workspaceId: string;
  agentId: string;
}

export type HandoffJobData = HandoffReapJob | HandoffNotifyJob;

export function createRedisConnection(redisUrl: string): IORedis {
  // BullMQ requires maxRetriesPerRequest: null on its connections.
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

const DEFAULT_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { count: 1_000 },
  removeOnFail: { count: 5_000 },
};

export function createSyncQueue(connection: IORedis) {
  return new Queue<SyncJobData>(QUEUE_NAMES.sync, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  });
}

export type SyncQueue = ReturnType<typeof createSyncQueue>;

/** One-shot pull, deduped per integration while queued. */
export async function enqueuePull(queue: SyncQueue, integrationId: string) {
  await queue.add(
    SYNC_JOBS.pullIntegration,
    { integrationId },
    { jobId: `pull-${integrationId}-${Date.now() >> 13}` }, // ~8s dedupe window
  );
}

export async function enqueueWebhook(
  queue: SyncQueue,
  integrationId: string,
  deliveryId: string,
) {
  await queue.add(
    SYNC_JOBS.processWebhook,
    { integrationId, deliveryId },
    { jobId: `webhook-${deliveryId}` },
  );
}

export async function enqueuePush(queue: SyncQueue, taskId: string, workspaceId: string) {
  await queue.add(SYNC_JOBS.pushTask, { taskId, workspaceId });
}

/** Repeatable poll for an integration (Google Tasks every 60s, etc.). */
export async function schedulePolling(
  queue: SyncQueue,
  integrationId: string,
  everyMs: number,
) {
  await queue.upsertJobScheduler(
    `poll-${integrationId}`,
    { every: everyMs },
    { name: SYNC_JOBS.pullIntegration, data: { integrationId } },
  );
}

/** Repeatable sweep renewing provider webhook subscriptions before they lapse. */
export async function scheduleSubscriptionRenewal(
  queue: SyncQueue,
  everyMs = 6 * 60 * 60 * 1000,
) {
  await queue.upsertJobScheduler(
    'renew-subscriptions',
    { every: everyMs },
    { name: SYNC_JOBS.renewSubscriptions, data: {} },
  );
}

export function createHandoffQueue(connection: IORedis) {
  return new Queue<HandoffJobData>(QUEUE_NAMES.handoff, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  });
}

export type HandoffQueue = ReturnType<typeof createHandoffQueue>;

/** Repeatable reaper sweep: requeue/fail handoffs with lapsed heartbeats. */
export async function scheduleReaper(queue: HandoffQueue, everyMs = 30_000) {
  await queue.upsertJobScheduler('handoff-reaper', { every: everyMs }, {
    name: HANDOFF_JOBS.reapExpired,
    data: {},
  });
}

export async function enqueueNotifyAgent(
  queue: HandoffQueue,
  handoffId: string,
  workspaceId: string,
  agentId: string,
) {
  await queue.add(
    HANDOFF_JOBS.notifyAgent,
    { handoffId, workspaceId, agentId },
    { jobId: `notify-${handoffId}` },
  );
}

export async function removePolling(queue: SyncQueue, integrationId: string) {
  await queue.removeJobScheduler(`poll-${integrationId}`);
}

export async function listPollingSchedulers(queue: SyncQueue): Promise<string[]> {
  const schedulers = await queue.getJobSchedulers();
  return schedulers
    .map((s) => s.key ?? s.id ?? '')
    .filter((k) => k.startsWith('poll-'))
    .map((k) => k.slice('poll-'.length));
}
