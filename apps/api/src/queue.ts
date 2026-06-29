import type { Queue } from 'bullmq';
import { loadEnv } from '@palouse/config';
import {
  createHandoffQueue,
  createRedisConnection,
  createSyncQueue,
  type HandoffJobData,
  type SyncJobData,
} from '@palouse/queue';

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
