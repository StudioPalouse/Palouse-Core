import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RateLimitStore } from '@palouse/queue';
import { _setRateLimitStoreForTest, clientIp, rateLimit } from './rate-limit.js';

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://localhost/none';
  process.env.REDIS_URL = 'redis://127.0.0.1:6399';
  process.env.BETTER_AUTH_SECRET = 'rate-limit-secret-rate-limit-secret!!';
  process.env.BETTER_AUTH_URL = 'http://localhost:4000';
  process.env.API_BASE_URL = 'http://localhost:4000';
  process.env.WEB_BASE_URL = 'http://localhost:3000';
  process.env.PALOUSE_ENCRYPTION_KEY = '0f'.repeat(32);
  const { _resetEnvForTest } = await import('@palouse/config');
  _resetEnvForTest();
});

afterEach(() => {
  _setRateLimitStoreForTest(undefined);
});

afterAll(async () => {
  const { _resetEnvForTest } = await import('@palouse/config');
  _resetEnvForTest();
});

/** In-memory fixed-window store mirroring the Redis one's contract. */
function memoryStore(): RateLimitStore {
  const counts = new Map<string, number>();
  return {
    async hit(bucket, id, limit, windowMs) {
      const key = `${bucket}:${id}`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { allowed: count <= limit, retryAfterSec: Math.ceil(windowMs / 1000) };
    },
  };
}

function appWith(mw: ReturnType<typeof rateLimit>) {
  const app = new Hono();
  app.use('*', mw);
  app.get('/x', (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimit middleware', () => {
  it('allows up to the limit then returns 429 with Retry-After', async () => {
    _setRateLimitStoreForTest(memoryStore());
    const app = appWith(rateLimit({ bucket: 'test', limit: 2 }));
    const headers = { 'fly-client-ip': '1.2.3.4' };

    expect((await app.request('/x', { headers })).status).toBe(200);
    expect((await app.request('/x', { headers })).status).toBe(200);
    const blocked = await app.request('/x', { headers });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('buckets separately per client', async () => {
    _setRateLimitStoreForTest(memoryStore());
    const app = appWith(rateLimit({ bucket: 'test', limit: 1 }));

    expect((await app.request('/x', { headers: { 'fly-client-ip': 'a' } })).status).toBe(200);
    // Different IP has its own window.
    expect((await app.request('/x', { headers: { 'fly-client-ip': 'b' } })).status).toBe(200);
    // First IP is now over the limit.
    expect((await app.request('/x', { headers: { 'fly-client-ip': 'a' } })).status).toBe(429);
  });

  it('is disabled when the limit is 0', async () => {
    _setRateLimitStoreForTest(memoryStore());
    const app = appWith(rateLimit({ bucket: 'test', limit: 0 }));
    for (let i = 0; i < 5; i++) {
      expect((await app.request('/x', { headers: { 'fly-client-ip': 'a' } })).status).toBe(200);
    }
  });

  it('fails open when the store errors', async () => {
    _setRateLimitStoreForTest({
      async hit() {
        throw new Error('redis down');
      },
    });
    const app = appWith(rateLimit({ bucket: 'test', limit: 1 }));
    // Even if the store throws, the middleware must let the request through.
    const res = await app.request('/x', { headers: { 'fly-client-ip': 'a' } });
    expect(res.status).toBe(200);
  });

  it('honors a custom key function', async () => {
    _setRateLimitStoreForTest(memoryStore());
    const app = new Hono();
    app.use('*', rateLimit({ bucket: 'test', limit: 1, key: (c) => c.req.header('x-agent') ?? 'none' }));
    app.get('/x', (c) => c.json({ ok: true }));

    expect((await app.request('/x', { headers: { 'x-agent': 'k1' } })).status).toBe(200);
    expect((await app.request('/x', { headers: { 'x-agent': 'k2' } })).status).toBe(200);
    expect((await app.request('/x', { headers: { 'x-agent': 'k1' } })).status).toBe(429);
  });
});

describe('clientIp', () => {
  it('prefers Fly-Client-IP', async () => {
    const app = new Hono();
    app.get('/x', (c) => c.json({ ip: clientIp(c) }));
    const res = await app.request('/x', {
      headers: { 'fly-client-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' },
    });
    expect(((await res.json()) as { ip: string }).ip).toBe('9.9.9.9');
  });

  it('falls back to the leftmost X-Forwarded-For hop', async () => {
    const app = new Hono();
    app.get('/x', (c) => c.json({ ip: clientIp(c) }));
    const res = await app.request('/x', { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } });
    expect(((await res.json()) as { ip: string }).ip).toBe('1.1.1.1');
  });
});
