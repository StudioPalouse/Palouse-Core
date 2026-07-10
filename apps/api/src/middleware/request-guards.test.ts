import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PalouseError } from '@palouse/shared';
import { assertBrowserSafe } from './request-guards.js';
import { bodyLimits } from './body-limits.js';

const WEB_ORIGIN = 'http://localhost:3000';

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://localhost/none';
  process.env.REDIS_URL = 'redis://127.0.0.1:6399';
  process.env.BETTER_AUTH_SECRET = 'request-guards-secret-request-guards!';
  process.env.BETTER_AUTH_URL = 'http://localhost:4000';
  process.env.API_BASE_URL = 'http://localhost:4000';
  process.env.WEB_BASE_URL = WEB_ORIGIN;
  process.env.PALOUSE_ENCRYPTION_KEY = '0f'.repeat(32);
  const { _resetEnvForTest } = await import('@palouse/config');
  _resetEnvForTest();
});

afterAll(async () => {
  const { _resetEnvForTest } = await import('@palouse/config');
  _resetEnvForTest();
});

function guardedApp() {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof PalouseError) {
      return c.json({ error: { code: err.code } }, err.status as 400);
    }
    throw err;
  });
  app.use('*', async (c, next) => {
    assertBrowserSafe(c);
    await next();
  });
  app.all('/thing', (c) => c.json({ ok: true }));
  return app;
}

describe('assertBrowserSafe (Origin + content-type)', () => {
  it('allows same-origin JSON mutations', async () => {
    const res = await guardedApp().request('/thing', {
      method: 'POST',
      headers: { origin: WEB_ORIGIN, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
  });

  it('rejects a cross-origin cookie mutation', async () => {
    const res = await guardedApp().request('/thing', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('rejects a missing Origin on an unsafe request', async () => {
    const res = await guardedApp().request('/thing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('rejects a wrong content-type when a body is present', async () => {
    const res = await guardedApp().request('/thing', {
      method: 'POST',
      headers: { origin: WEB_ORIGIN, 'content-type': 'text/plain', 'content-length': '5' },
      body: 'hello',
    });
    expect(res.status).toBe(415);
  });

  it('allows a bodyless DELETE with a valid Origin and no content-type', async () => {
    const res = await guardedApp().request('/thing', {
      method: 'DELETE',
      headers: { origin: WEB_ORIGIN },
    });
    expect(res.status).toBe(200);
  });

  it('leaves safe methods untouched (no Origin required)', async () => {
    const res = await guardedApp().request('/thing', { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('accepts application/json with a charset parameter', async () => {
    const res = await guardedApp().request('/thing', {
      method: 'PATCH',
      headers: { origin: WEB_ORIGIN, 'content-type': 'application/json; charset=utf-8' },
      body: '{}',
    });
    expect(res.status).toBe(200);
  });
});

describe('bodyLimits', () => {
  function limitedApp() {
    const app = new Hono();
    app.use('*', bodyLimits());
    app.post('/v1/thing', (c) => c.json({ ok: true }));
    app.post('/api/auth/sign-in', (c) => c.json({ ok: true }));
    app.post('/v1/otlp/v1/traces', (c) => c.json({ ok: true }));
    return app;
  }

  it('rejects a body over the default 1MB limit before the handler runs', async () => {
    const res = await limitedApp().request('/v1/thing', {
      method: 'POST',
      headers: { 'content-length': String(2 * 1024 * 1024), 'content-type': 'application/json' },
      body: 'x'.repeat(2 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
  });

  it('applies a tighter 64KB limit to auth routes', async () => {
    const res = await limitedApp().request('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'content-length': String(100 * 1024), 'content-type': 'application/json' },
      body: 'x'.repeat(100 * 1024),
    });
    expect(res.status).toBe(413);
  });

  it('allows a larger body under the OTLP 5MB ceiling', async () => {
    const size = 2 * 1024 * 1024;
    const res = await limitedApp().request('/v1/otlp/v1/traces', {
      method: 'POST',
      headers: { 'content-length': String(size), 'content-type': 'application/json' },
      body: 'x'.repeat(size),
    });
    expect(res.status).toBe(200);
  });

  it('passes small requests through', async () => {
    const res = await limitedApp().request('/v1/thing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
  });
});
