import type { Queue } from 'bullmq';
import { loadEnv } from '@reqops/config';
import { createRedisConnection, createSyncQueue, type SyncJobData } from '@reqops/queue';

let cached: Queue<SyncJobData> | undefined;

export function getSyncQueue(): Queue<SyncJobData> {
  if (!cached) {
    cached = createSyncQueue(createRedisConnection(loadEnv().REDIS_URL));
  }
  return cached;
}
