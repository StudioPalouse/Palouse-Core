'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Shared subscription to the workspace event stream (`GET /v1/events`).
 *
 * One EventSource per workspace per tab, held in a module-level registry and
 * reference-counted, the same shape the capability map already uses. A naive
 * `new EventSource(...)` inside each consumer would open one connection per
 * mounted component and multiply the server's fanout cost for no benefit.
 *
 * Events carry ids only. Consumers refetch through the normal endpoints rather
 * than patching local state from the payload, so the stream cannot become a
 * second read path.
 */

export type WorkspaceEventType = 'task.changed' | 'handoff.changed';

export interface WorkspaceEventMessage {
  type: WorkspaceEventType;
  taskId?: string;
  handoffId?: string;
}

type Listener = (event: WorkspaceEventMessage) => void;
type StatusListener = (connected: boolean) => void;

interface Subscription {
  source: EventSource;
  listeners: Set<Listener>;
  statusListeners: Set<StatusListener>;
  connected: boolean;
  refCount: number;
  retry: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
}

const registry = new Map<string, Subscription>();

const EVENT_TYPES: WorkspaceEventType[] = ['task.changed', 'handoff.changed'];
const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

function setConnected(sub: Subscription, connected: boolean): void {
  if (sub.connected === connected) return;
  sub.connected = connected;
  for (const listener of [...sub.statusListeners]) listener(connected);
}

function openSource(workspaceId: string, sub: Subscription): EventSource {
  const source = new EventSource(
    `/v1/events?workspaceId=${encodeURIComponent(workspaceId)}`,
    { withCredentials: true },
  );

  source.onopen = () => {
    sub.retry = 0;
    setConnected(sub, true);
  };

  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (raw) => {
      setConnected(sub, true);
      let payload: WorkspaceEventMessage;
      try {
        payload = JSON.parse((raw as MessageEvent<string>).data) as WorkspaceEventMessage;
      } catch {
        return;
      }
      for (const listener of [...sub.listeners]) listener(payload);
    });
  }

  // EventSource reconnects on its own, but not after the server closes the
  // stream deliberately (a 403 once Tasks is turned off, for instance), and its
  // built-in retry has no backoff. Own the reconnect so a dead API is not
  // hammered, and so consumers see `connected: false` and resume polling.
  source.onerror = () => {
    setConnected(sub, false);
    source.close();
    if (sub.refCount === 0) return;
    const delay = Math.min(BASE_RETRY_MS * 2 ** sub.retry, MAX_RETRY_MS);
    sub.retry += 1;
    sub.reconnectTimer = setTimeout(() => {
      if (sub.refCount === 0) return;
      sub.source = openSource(workspaceId, sub);
    }, delay);
  };

  return source;
}

function acquire(workspaceId: string): Subscription {
  let sub = registry.get(workspaceId);
  if (!sub) {
    sub = {
      source: undefined as unknown as EventSource,
      listeners: new Set(),
      statusListeners: new Set(),
      connected: false,
      refCount: 0,
      retry: 0,
    };
    registry.set(workspaceId, sub);
    sub.source = openSource(workspaceId, sub);
  }
  sub.refCount += 1;
  return sub;
}

function release(workspaceId: string, sub: Subscription): void {
  sub.refCount -= 1;
  if (sub.refCount > 0) return;
  // Last consumer for this workspace. Closing here is what stops a long-lived
  // tab from holding a subscription to a workspace the user has switched away
  // from, which would otherwise keep delivering another tenant's ids.
  if (sub.reconnectTimer) clearTimeout(sub.reconnectTimer);
  sub.source?.close();
  registry.delete(workspaceId);
}

/**
 * Calls `onEvent` for matching events on this workspace's stream, and reports
 * whether the stream is currently connected so the caller can decide whether
 * its polling fallback is still needed.
 *
 * `onEvent` is read through a ref, so a caller may pass an inline closure
 * without tearing the subscription down on every render.
 */
export function useWorkspaceEvents(
  workspaceId: string | undefined,
  types: WorkspaceEventType[],
  onEvent: () => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const typesKey = types.join(',');

  useEffect(() => {
    if (!workspaceId || typeof window === 'undefined') return;
    const wanted = new Set(typesKey.split(',') as WorkspaceEventType[]);
    const sub = acquire(workspaceId);

    const listener: Listener = (event) => {
      if (wanted.has(event.type)) handlerRef.current();
    };
    const statusListener: StatusListener = (isConnected) => setConnected(isConnected);

    sub.listeners.add(listener);
    sub.statusListeners.add(statusListener);
    setConnected(sub.connected);

    return () => {
      sub.listeners.delete(listener);
      sub.statusListeners.delete(statusListener);
      release(workspaceId, sub);
    };
  }, [workspaceId, typesKey]);

  return { connected };
}

/**
 * How often a surface should poll given the stream's health: the existing
 * cadence while disconnected, a long safety-net interval while connected.
 *
 * Polling never stops entirely. A stream that is "connected" but silently
 * broken (a proxy holding the socket open, say) would otherwise leave the board
 * frozen with no refresh at all, which is worse than today's behavior.
 */
export function pollIntervalFor(connected: boolean, baseMs: number): number {
  return connected ? baseMs * 8 : baseMs;
}
