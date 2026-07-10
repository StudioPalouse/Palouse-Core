import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler } from 'hono';

const KB = 1024;
const MB = 1024 * KB;

/**
 * Per-path request body ceilings, checked against Content-Length up front and
 * metered on the stream, so an oversized request is rejected before its body
 * is buffered. Longest-prefix wins; everything else gets DEFAULT_LIMIT.
 *
 * Self-hosters who ingest unusually large OTLP batches or CSV imports can bump
 * these (see docs/deployment.md). Auth and webhook paths are deliberately
 * tight: they take small payloads and are the most exposed.
 */
const DEFAULT_LIMIT = 1 * MB;
const LIMITS: ReadonlyArray<{ prefix: string; maxSize: number }> = [
  { prefix: '/v1/otlp', maxSize: 5 * MB },
  { prefix: '/v1/objectives/import', maxSize: 2 * MB },
  { prefix: '/webhooks', maxSize: 256 * KB },
  { prefix: '/api/auth', maxSize: 64 * KB },
];

/**
 * One body-limit middleware for the whole app: picks the ceiling by path and
 * delegates to hono's built-in bodyLimit (413 on exceed). A single instance
 * avoids stacking two limiters on one request, where the smaller would always
 * win and the larger route ceiling would never take effect.
 */
export function bodyLimits(): MiddlewareHandler {
  const bySize = new Map<number, MiddlewareHandler>();
  const limiterFor = (maxSize: number): MiddlewareHandler => {
    let mw = bySize.get(maxSize);
    if (!mw) {
      mw = bodyLimit({ maxSize });
      bySize.set(maxSize, mw);
    }
    return mw;
  };

  return createMiddleware(async (c, next) => {
    const path = c.req.path;
    let maxSize = DEFAULT_LIMIT;
    let longest = -1;
    for (const rule of LIMITS) {
      if (path.startsWith(rule.prefix) && rule.prefix.length > longest) {
        maxSize = rule.maxSize;
        longest = rule.prefix.length;
      }
    }
    return limiterFor(maxSize)(c, next);
  });
}
