import { loadEnv } from '@palouse/config';
import { createKeyRevocationStore, type KeyRevocationStore } from '@palouse/queue';

let cached: KeyRevocationStore | undefined;

/** Lazy singleton: one fail-fast Redis connection per process for tombstones. */
export function getKeyRevocationStore(): KeyRevocationStore {
  cached ??= createKeyRevocationStore(loadEnv().REDIS_URL);
  return cached;
}
