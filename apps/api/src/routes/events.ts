import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { validation } from '@palouse/shared';
import type { WorkspaceEvent } from '@palouse/queue';
import { loadEnv } from '@palouse/config';
import { getDb } from '@palouse/db';
import { requireTasksAccess } from '../capability-access.js';
import { requireSession, type SessionVars } from '../middleware/session.js';
import { getEventBus } from '../queue.js';

export const eventRoutes = new Hono<SessionVars>();

eventRoutes.use('*', requireSession);

/**
 * Idle proxies close a quiet connection, and a browser cannot tell a silent
 * stream from a dead one. A comment frame is the SSE-native keepalive: it
 * reaches no `onmessage` handler, so clients need no special case for it.
 */
const HEARTBEAT_MS = 25_000;

/**
 * Authenticated per-workspace event stream. Events carry ids only; the client
 * refetches through the normal endpoints, so this never becomes a second read
 * path that could expose a field the REST layer gates.
 */
eventRoutes.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');

  const db = getDb(loadEnv().DATABASE_URL);
  // Membership plus the Tasks capability, the same guard the task routes use:
  // a workspace with Tasks off should not get a task event stream either.
  await requireTasksAccess(db, workspaceId, c.get('userId'));

  return streamSSE(c, async (stream) => {
    const bus = getEventBus();
    // Buffered rather than written directly: `writeSSE` is async and events can
    // arrive faster than the socket drains, which would interleave frames.
    const pending: WorkspaceEvent[] = [];
    let notify: (() => void) | undefined;

    const unsubscribe = bus.subscribe(workspaceId, (event) => {
      pending.push(event);
      notify?.();
    });

    // Reference counting lives in the bus, so this is the whole cleanup: the
    // last stream for a workspace releases its Redis subscription.
    stream.onAbort(() => {
      unsubscribe();
      notify?.();
    });

    try {
      while (!stream.aborted && !stream.closed) {
        while (pending.length > 0) {
          const event = pending.shift()!;
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        }
        if (stream.aborted || stream.closed) break;

        // Wake on either a new event or the heartbeat deadline, whichever comes
        // first, so an event is never delayed by up to a full heartbeat.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, HEARTBEAT_MS);
          notify = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        notify = undefined;

        if (pending.length === 0 && !stream.aborted && !stream.closed) {
          await stream.writeSSE({ data: '', event: 'ping' });
        }
      }
    } finally {
      unsubscribe();
    }
  });
});
