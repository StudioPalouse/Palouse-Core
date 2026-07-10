import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { loadEnv } from '@palouse/config';
import { createRateLimitStore, type RateLimitStore } from '@palouse/queue';
import { logger } from '../logger.js';

let store: RateLimitStore | undefined;
function getStore(): RateLimitStore {
  store ??= createRateLimitStore(loadEnv().REDIS_URL);
  return store;
}

/** Test seam: swap the shared store for a fake. */
export function _setRateLimitStoreForTest(fake: RateLimitStore | undefined): void {
  store = fake;
}

const WINDOW_MS = 60_000;

/**
 * Client IP behind Fly's proxy. Fly-Client-IP is set by the edge and cannot be
 * spoofed by the client; the X-Forwarded-For leftmost hop is the fallback for
 * other front proxies. Falls back to a constant so a missing header shares one
 * bucket rather than bypassing the limit.
 */
export function clientIp(c: Context): string {
  const fly = c.req.header('fly-client-ip');
  if (fly) return fly;
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return 'unknown';
}

export interface RateLimitOptions {
  bucket: string;
  /** Requests allowed per minute. 0 disables the limiter. */
  limit: number;
  /** Derives the client identity to bucket on. Defaults to the client IP. */
  key?: (c: Context) => string;
}

/**
 * Fixed-window rate limiter. Over-limit requests get 429 with Retry-After;
 * the underlying store fails open, so a Redis outage never blocks traffic.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const keyFn = opts.key ?? clientIp;
  return createMiddleware(async (c, next) => {
    if (opts.limit <= 0) return next();
    const id = keyFn(c);
    let allowed = true;
    let retryAfterSec = 0;
    try {
      ({ allowed, retryAfterSec } = await getStore().hit(opts.bucket, id, opts.limit, WINDOW_MS));
    } catch (err) {
      // Fail open: a limiter must never become an outage amplifier.
      logger.warn({ bucket: opts.bucket, err: (err as Error).message }, 'Rate limiter unavailable');
      return next();
    }
    if (!allowed) {
      logger.warn({ bucket: opts.bucket, id }, 'Rate limit exceeded');
      c.header('Retry-After', String(retryAfterSec));
      return c.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down and retry.' } },
        429,
      );
    }
    return next();
  });
}
