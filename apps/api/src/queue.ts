import type { Queue } from 'bullmq';
import { loadEnv } from '@palouse/config';
import {
  createHandoffQueue,
  createRedisConnection,
  createSyncQueue,
  createWorkspaceEventBus,
  type HandoffJobData,
  type SyncJobData,
  type WorkspaceEventBus,
} from '@palouse/queue';
import { logger } from './logger.js';

let cached: Queue<SyncJobData> | undefined;
let cachedHandoff: Queue<HandoffJobData> | undefined;

export function getSyncQueue(): Queue<SyncJobData> {
  if (!cached) {
    cached = createSyncQueue(createRedisConnection(loadEnv().REDIS_URL));
  }
  return cached;
}

export function getHandoffQueue(): Queue<HandoffJobData> {
  if (!cachedHandoff) {
    cachedHandoff = createHandoffQueue(createRedisConnection(loadEnv().REDIS_URL));
  }
  return cachedHandoff;
}

let cachedEvents: WorkspaceEventBus | undefined;

/**
 * Process-wide event bus behind the SSE stream. One instance per API process,
 * which is what keeps the Redis subscription count proportional to workspaces
 * with an open stream rather than to connected browser tabs.
 */
export function getEventBus(): WorkspaceEventBus {
  if (!cachedEvents) {
    cachedEvents = createWorkspaceEventBus(loadEnv().REDIS_URL, {
      onError: (err) => logger.warn({ err: err.message }, 'Workspace event bus error'),
    });
  }
  return cachedEvents;
}

/** Test seam: swap the bus for a fake. */
export function _setEventBusForTest(fake: WorkspaceEventBus | undefined): void {
  cachedEvents = fake;
}
