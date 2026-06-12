import { loadEnv } from '@reqops/config';
import { createRedisConnection, createSyncQueue, type SyncQueue } from '@reqops/queue';

let cached: SyncQueue | undefined;

export function getSyncQueue(): SyncQueue {
  if (!cached) {
    cached = createSyncQueue(createRedisConnection(loadEnv().REDIS_URL));
  }
  return cached;
}
