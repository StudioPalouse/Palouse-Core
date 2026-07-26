import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceEventBus, workspaceChannel, type WorkspaceEvent } from '@palouse/queue';

/**
 * The bus behind the SSE stream. Two properties matter most and neither is
 * visible from the endpoint: a subscriber must never see another tenant's
 * events, and Redis subscriptions must be released when the last stream for a
 * workspace closes. Upstash bills per connection and per command, so a leak
 * here is a bill as well as a bug.
 */

/** Minimal ioredis stand-in: records subscribe/unsubscribe and routes messages. */
function fakeRedis() {
  const listeners: Array<(channel: string, payload: string) => void> = [];
  const client = {
    subscribed: new Set<string>(),
    subscribeCalls: 0,
    unsubscribeCalls: 0,
    published: [] as Array<{ channel: string; payload: string }>,
    on(event: string, handler: (...args: never[]) => void) {
      if (event === 'message') listeners.push(handler as never);
      return client;
    },
    async subscribe(channel: string) {
      client.subscribeCalls += 1;
      client.subscribed.add(channel);
    },
    async unsubscribe(channel: string) {
      client.unsubscribeCalls += 1;
      client.subscribed.delete(channel);
    },
    async publish(channel: string, payload: string) {
      client.published.push({ channel, payload });
      // Loop back so one fake can act as both ends.
      for (const listener of listeners) listener(channel, payload);
      return 1;
    },
    async quit() {},
  };
  return client;
}

function busWithFake() {
  const client = fakeRedis();
  const bus = createWorkspaceEventBus('redis://ignored', {
    createClient: () => client as never,
    onError: () => {},
  });
  return { bus, client };
}

const event = (taskId: string): WorkspaceEvent => ({
  type: 'task.changed',
  taskId,
  action: 'updated',
  at: '2026-07-26T00:00:00.000Z',
});

describe('workspace event bus', () => {
  it('delivers an event to every subscriber of that workspace', () => {
    const { bus } = busWithFake();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe('ws-1', a);
    bus.subscribe('ws-1', b);

    bus.publish('ws-1', event('task-1'));

    expect(a).toHaveBeenCalledWith(event('task-1'));
    expect(b).toHaveBeenCalledWith(event('task-1'));
  });

  // Tenant isolation is the whole reason the channel is keyed per workspace.
  it('never delivers another workspace event', () => {
    const { bus } = busWithFake();
    const listener = vi.fn();
    bus.subscribe('ws-1', listener);

    bus.publish('ws-2', event('task-2'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('opens one Redis subscription per workspace, not per subscriber', () => {
    const { bus, client } = busWithFake();
    bus.subscribe('ws-1', vi.fn());
    bus.subscribe('ws-1', vi.fn());
    bus.subscribe('ws-1', vi.fn());

    expect(client.subscribeCalls).toBe(1);
    expect(client.subscribed.has(workspaceChannel('ws-1'))).toBe(true);
  });

  it('releases the subscription only when the last subscriber leaves', () => {
    const { bus, client } = busWithFake();
    const offA = bus.subscribe('ws-1', vi.fn());
    const offB = bus.subscribe('ws-1', vi.fn());

    offA();
    expect(client.unsubscribeCalls).toBe(0);
    expect(client.subscribed.has(workspaceChannel('ws-1'))).toBe(true);

    offB();
    expect(client.unsubscribeCalls).toBe(1);
    expect(client.subscribed.has(workspaceChannel('ws-1'))).toBe(false);
  });

  // A stream that cleans up twice (abort handler plus the finally block) must
  // not tear down a subscription a newer stream is relying on.
  it('is safe to unsubscribe twice', () => {
    const { bus, client } = busWithFake();
    const off = bus.subscribe('ws-1', vi.fn());
    off();
    off();
    expect(client.unsubscribeCalls).toBe(1);

    const listener = vi.fn();
    bus.subscribe('ws-1', listener);
    bus.publish('ws-1', event('task-3'));
    expect(listener).toHaveBeenCalledOnce();
  });

  it('keeps delivering after a handler throws', () => {
    const { bus } = busWithFake();
    const good = vi.fn();
    bus.subscribe('ws-1', () => {
      throw new Error('handler blew up');
    });
    bus.subscribe('ws-1', good);

    expect(() => bus.publish('ws-1', event('task-4'))).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
  });

  // A mutation must succeed even when Redis is unreachable.
  it('never throws out of publish when the client fails', () => {
    const bus = createWorkspaceEventBus('redis://ignored', {
      createClient: () => {
        throw new Error('redis down');
      },
      onError: () => {},
    });
    expect(() => bus.publish('ws-1', event('task-5'))).not.toThrow();
  });
});
