import { secureHeaders } from 'hono/secure-headers';
import type { MiddlewareHandler } from 'hono';

/**
 * HTTP hardening headers for the API. The API only ever returns JSON and
 * redirects (its sign-in/consent pages live in the web app), so the CSP can be
 * locked all the way down: nothing may load, and nothing may frame a response.
 * HSTS, nosniff, and a no-referrer policy round it out. Applied on every
 * response, including OAuth discovery and MCP metadata.
 */
export function securityHeaders(): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
    referrerPolicy: 'no-referrer',
    strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
    // Redundant with frame-ancestors above, but set for older browsers.
    xFrameOptions: 'DENY',
  });
}
