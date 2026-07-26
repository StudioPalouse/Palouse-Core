import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { CLIENT_IP_HEADER } from '@palouse/shared';
import { withResolvedClientIp } from './client-ip.js';

/**
 * Guards the fix for Better-Auth's shared rate-limit bucket. Without a
 * resolvable client IP it keys every user into one bucket and its 3-per-10s
 * sign-in rule becomes a global lockout, so these assert that a real IP is
 * stamped and that a client cannot choose its own.
 */
async function stampedHeaderFor(headers: Record<string, string>): Promise<string | null> {
  const app = new Hono();
  app.get('/probe', (c) => {
    const forwarded = withResolvedClientIp(c);
    return c.json({ stamped: forwarded.headers.get(CLIENT_IP_HEADER) });
  });
  const res = await app.request('/probe', { headers });
  const body = (await res.json()) as { stamped: string | null };
  return body.stamped;
}

describe('withResolvedClientIp', () => {
  it('stamps the Fly edge client IP', async () => {
    await expect(stampedHeaderFor({ 'fly-client-ip': '203.0.113.7' })).resolves.toBe('203.0.113.7');
  });

  it('stamps the leftmost hop of a forwarded chain, which Better Auth alone discards', async () => {
    await expect(
      stampedHeaderFor({ 'x-forwarded-for': '203.0.113.7, 70.0.0.1, 10.0.0.2' }),
    ).resolves.toBe('203.0.113.7');
  });

  it('prefers the Fly header over a forwarded chain', async () => {
    await expect(
      stampedHeaderFor({
        'fly-client-ip': '203.0.113.7',
        'x-forwarded-for': '198.51.100.9, 10.0.0.2',
      }),
    ).resolves.toBe('203.0.113.7');
  });

  // The whole point of stamping is that this header is trustworthy downstream.
  // If a caller could set it, anyone could pick their own rate-limit bucket, or
  // exhaust someone else's.
  it('overwrites a client-supplied value rather than trusting it', async () => {
    await expect(
      stampedHeaderFor({
        [CLIENT_IP_HEADER]: '1.2.3.4',
        'fly-client-ip': '203.0.113.7',
      }),
    ).resolves.toBe('203.0.113.7');
  });

  it('drops a client-supplied value when no trusted header is present', async () => {
    await expect(stampedHeaderFor({ [CLIENT_IP_HEADER]: '1.2.3.4' })).resolves.toBeNull();
  });

  it('stamps nothing when the IP cannot be resolved', async () => {
    await expect(stampedHeaderFor({})).resolves.toBeNull();
  });
});
