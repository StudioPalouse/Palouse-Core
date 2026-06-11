import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { loadEnv } from '@reqops/config';
import { getDb, integrations } from '@reqops/db';
import {
  createHandoffQueue,
  createRedisConnection,
  createSyncQueue,
  listPollingSchedulers,
  removePolling,
  schedulePolling,
  scheduleReaper,
  scheduleSubscriptionRenewal,
  HANDOFF_JOBS,
  QUEUE_NAMES,
  SYNC_JOBS,
  type HandoffJobData,
  type HandoffNotifyJob,
  type SyncJobData,
  type SyncProcessWebhookJob,
  type SyncPullJob,
  type SyncPushJob,
} from '@reqops/queue';
import { adapterFor, POLL_INTERVAL_MS } from './adapters.js';
import { runNotifyAgent, runReapExpired } from './handoffs.js';
import { runProcessWebhook, runPull, runPush, runRenewSubscriptions } from './sync.js';

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL, base: { service: 'reqops-worker' } });
const db = getDb(env.DATABASE_URL);
const connection = createRedisConnection(env.REDIS_URL);
const syncQueue = createSyncQueue(connection);

const worker = new Worker<SyncJobData>(
  QUEUE_NAMES.sync,
  async (job) => {
    switch (job.name) {
      case SYNC_JOBS.pullIntegration: {
        const { integrationId } = job.data as SyncPullJob;
        await runPull(db, env, logger, integrationId);
        break;
      }
      case SYNC_JOBS.processWebhook: {
        const { integrationId, deliveryId } = job.data as SyncProcessWebhookJob;
        await runProcessWebhook(db, env, logger, integrationId, deliveryId);
        break;
      }
      case SYNC_JOBS.pushTask: {
        const { taskId } = job.data as SyncPushJob;
        await runPush(db, env, logger, taskId);
        break;
      }
      case SYNC_JOBS.renewSubscriptions: {
        await runRenewSubscriptions(db, env, logger);
        break;
      }
      default:
        logger.warn({ name: job.name }, 'Unknown sync job');
    }
  },
  { connection, concurrency: 5 },
);

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, name: job?.name, err: err.message }, 'Sync job failed');
});

const handoffQueue = createHandoffQueue(connection);

const handoffWorker = new Worker<HandoffJobData>(
  QUEUE_NAMES.handoff,
  async (job) => {
    switch (job.name) {
      case HANDOFF_JOBS.reapExpired:
        await runReapExpired(db, logger);
        break;
      case HANDOFF_JOBS.notifyAgent:
        await runNotifyAgent(logger, job.data as HandoffNotifyJob);
        break;
      default:
        logger.warn({ name: job.name }, 'Unknown handoff job');
    }
  },
  { connection, concurrency: 2 },
);

handoffWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, name: job?.name, err: err.message }, 'Handoff job failed');
});

/**
 * Keeps repeatable poll schedulers in lockstep with active integrations:
 * adds missing ones, removes orphans. Runs at boot and every 5 minutes.
 */
async function reconcilePolling(): Promise<void> {
  const active = await db
    .select({ id: integrations.id, provider: integrations.provider })
    .from(integrations)
    .where(eq(integrations.status, 'active'));

  const wanted = new Map<string, number>();
  for (const row of active) {
    try {
      adapterFor(row.provider);
    } catch {
      continue; // provider not implemented yet (M4)
    }
    const interval = POLL_INTERVAL_MS[row.provider];
    if (interval) wanted.set(row.id, interval);
  }

  const scheduled = await listPollingSchedulers(syncQueue);
  for (const [integrationId, everyMs] of wanted) {
    await schedulePolling(syncQueue, integrationId, everyMs);
  }
  for (const integrationId of scheduled) {
    if (!wanted.has(integrationId)) await removePolling(syncQueue, integrationId);
  }
  logger.info({ polling: wanted.size }, 'Polling reconciled');
}

await reconcilePolling().catch((err) => logger.error({ err }, 'Polling reconcile failed'));
await scheduleSubscriptionRenewal(syncQueue).catch((err) =>
  logger.error({ err }, 'Failed to schedule subscription renewal sweep'),
);
await scheduleReaper(handoffQueue).catch((err) =>
  logger.error({ err }, 'Failed to schedule handoff reaper'),
);
const reconcileTimer = setInterval(
  () => void reconcilePolling().catch((err) => logger.error({ err }, 'Polling reconcile failed')),
  5 * 60_000,
);

logger.info('ReqOps worker ready — sync queue consuming');

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  clearInterval(reconcileTimer);
  await worker.close();
  await handoffWorker.close();
  await syncQueue.close();
  await handoffQueue.close();
  connection.disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
