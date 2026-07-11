import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { securityHeaders } from './security-headers.js';

function app() {
  const a = new Hono();
  a.use('*', securityHeaders());
  a.get('/v1', (c) => c.json({ ok: true }));
  a.get('/.well-known/oauth-authorization-server', (c) => c.json({ issuer: 'x' }));
  return a;
}

describe('securityHeaders', () => {
  it('sets a locked-down CSP and hardening headers on JSON responses', async () => {
    const res = await app().request('/v1');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=63072000');
  });

  it('applies to OAuth discovery responses too', async () => {
    const res = await app().request('/.well-known/oauth-authorization-server');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
