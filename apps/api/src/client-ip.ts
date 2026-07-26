import type { Context } from 'hono';
import { CLIENT_IP_HEADER } from '@palouse/shared';
import { clientIp } from './middleware/rate-limit.js';

/**
 * Hands Better Auth a request carrying the client IP as a single header value.
 *
 * Better Auth rate-limits sign-in and sign-up to 3 requests per 10 seconds,
 * keyed on the client IP, and falls back to ONE bucket shared by every user
 * when it cannot resolve one. Its parser refuses a multi-hop X-Forwarded-For
 * chain unless every proxy CIDR is enumerated in `trustedProxies`, which here
 * would mean tracking Fly's edge ranges plus a private machine address that
 * changes on each deploy. Behind our proxy chain it resolved nothing, so three
 * sign-in attempts from anyone locked sign-in for everyone until the window
 * rolled.
 *
 * Resolving it once, here, keeps a single decision about which forwarded
 * headers this deployment trusts (`clientIp`, shared with our own limiter)
 * rather than a second, differently-configured trust model inside the auth
 * library.
 */
export function withResolvedClientIp(c: Context): Request {
  const ip = clientIp(c);
  const headers = new Headers(c.req.raw.headers);

  if (ip === 'unknown') {
    // No trusted header to resolve from. The inbound value must still be
    // removed rather than passed through: leaving it would let any caller name
    // its own rate-limit bucket, or drain someone else's, just by sending this
    // header. Better Auth then falls back to its shared bucket, which is where
    // it already was.
    headers.delete(CLIENT_IP_HEADER);
  } else {
    // set, never append, so a value the caller supplied is always discarded.
    headers.set(CLIENT_IP_HEADER, ip);
  }
  return new Request(c.req.raw, { headers });
}
