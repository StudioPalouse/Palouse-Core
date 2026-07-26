import IORedis from 'ioredis';

/**
 * Per-workspace event fanout over Redis pub/sub, behind the API's SSE stream.
 *
 * Pub/sub rather than an in-process emitter because prod runs more than one
 * API machine (`auto_start_machines`), and an in-memory bus would work in dev
 * and silently drop events for anyone connected to a different machine.
 *
 * Events are ID-only by design. Subscribers refetch through the existing
 * authorized endpoints, so the stream never becomes a second read path and
 * cannot leak a field the REST layer would have gated. Keep that property when
 * adding event types.
 */

export interface TaskChangedEvent {
  type: 'task.changed';
  taskId: string;
  action: 'created' | 'updated' | 'commented';
  at: string;
}

export interface HandoffChangedEvent {
  type: 'handoff.changed';
  handoffId: string;
  taskId: string;
  state: string;
  at: string;
}

export type WorkspaceEvent = TaskChangedEvent | HandoffChangedEvent;

/** One channel per workspace, so a subscriber only ever sees its own tenant. */
export function workspaceChannel(workspaceId: string): string {
  return `ws:${workspaceId}:events`;
}

export type EventHandler = (event: WorkspaceEvent) => void;

/**
 * Publishing and subscribing share a URL but not a connection: an ioredis
 * client in subscriber mode cannot issue ordinary commands, so a publish would
 * fail on it.
 *
 * Both connections are lazy. A deployment that never opens a stream and never
 * mutates anything pays for neither.
 */
export interface WorkspaceEventBus {
  /** Fire and forget. Never throws: a Redis hiccup must not fail a mutation. */
  publish(workspaceId: string, event: WorkspaceEvent): void;
  /** Returns an unsubscribe function. */
  subscribe(workspaceId: string, handler: EventHandler): () => void;
  close(): Promise<void>;
}

/** Options exist so tests can inject a fake ioredis pair. */
export interface EventBusOptions {
  createClient?: (redisUrl: string) => IORedis;
  onError?: (err: Error) => void;
}

export function createWorkspaceEventBus(
  redisUrl: string,
  opts: EventBusOptions = {},
): WorkspaceEventBus {
  // Not createRedisConnection: its `maxRetriesPerRequest: null` is a BullMQ
  // requirement, and it is the wrong shape for a long-lived subscriber, where
  // a command that can never fail is a command that can hang forever.
  const create = opts.createClient ?? ((url: string) => new IORedis(url));
  const report = opts.onError ?? (() => {});

  let publisher: IORedis | undefined;
  let subscriber: IORedis | undefined;

  // One Redis subscription per workspace per process, fanned out in memory to
  // however many streams are open. Upstash bills per command and per
  // connection, so a subscription per browser tab is the naive shape and the
  // expensive one.
  const handlers = new Map<string, Set<EventHandler>>();

  function getSubscriber(): IORedis {
    if (!subscriber) {
      subscriber = create(redisUrl);
      subscriber.on('error', (err: Error) => report(err));
      subscriber.on('message', (channel: string, payload: string) => {
        const listeners = handlers.get(channel);
        if (!listeners?.size) return;
        let event: WorkspaceEvent;
        try {
          event = JSON.parse(payload) as WorkspaceEvent;
        } catch (err) {
          report(err as Error);
          return;
        }
        // Copy first: a handler may unsubscribe itself while being called.
        for (const listener of [...listeners]) {
          try {
            listener(event);
          } catch (err) {
            report(err as Error);
          }
        }
      });
    }
    return subscriber;
  }

  return {
    publish(workspaceId, event) {
      try {
        publisher ??= create(redisUrl);
        publisher.on('error', (err: Error) => report(err));
        void publisher
          .publish(workspaceChannel(workspaceId), JSON.stringify(event))
          .catch((err: Error) => report(err));
      } catch (err) {
        report(err as Error);
      }
    },

    subscribe(workspaceId, handler) {
      const channel = workspaceChannel(workspaceId);
      const client = getSubscriber();
      let listeners = handlers.get(channel);
      if (!listeners) {
        listeners = new Set();
        handlers.set(channel, listeners);
        void client.subscribe(channel).catch((err: Error) => report(err));
      }
      listeners.add(handler);

      let released = false;
      return () => {
        // Guard against a double unsubscribe dropping a live subscription that
        // a later stream re-established under the same channel.
        if (released) return;
        released = true;
        const current = handlers.get(channel);
        if (!current) return;
        current.delete(handler);
        if (current.size === 0) {
          handlers.delete(channel);
          void client.unsubscribe(channel).catch((err: Error) => report(err));
        }
      };
    },

    async close() {
      handlers.clear();
      await Promise.allSettled([subscriber?.quit(), publisher?.quit()]);
      subscriber = undefined;
      publisher = undefined;
    },
  };
}
