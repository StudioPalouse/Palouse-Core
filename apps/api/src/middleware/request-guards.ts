import type { Context } from 'hono';
import { forbidden, PalouseError } from '@palouse/shared';
import { loadEnv } from '@palouse/config';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF and content-type guard for cookie-authenticated requests. CORS is a
 * response-side control and does not stop a cross-site form/fetch from
 * reaching the handler, so every unsafe, cookie-authed request must carry an
 * Origin matching the web app. Browsers always send Origin on unsafe fetches
 * and the web proxy forwards it; a cross-origin or Origin-less request is
 * rejected. Requests with a body must also declare application/json, the only
 * content type these routes parse. Non-browser callers that drive the API
 * directly with a session cookie must set Origin themselves
 * (see docs/deployment.md).
 */
export function assertBrowserSafe(c: Context): void {
  const method = c.req.method.toUpperCase();
  if (!UNSAFE_METHODS.has(method)) return;

  const expectedOrigin = loadEnv().WEB_BASE_URL;
  if (c.req.header('origin') !== expectedOrigin) {
    throw forbidden('Cross-origin request rejected');
  }

  const hasBody =
    c.req.header('transfer-encoding') !== undefined ||
    Number(c.req.header('content-length') ?? '0') > 0;
  if (hasBody) {
    const contentType = (c.req.header('content-type') ?? '').toLowerCase();
    if (!contentType.includes('application/json')) {
      throw new PalouseError('VALIDATION', 'Content-Type must be application/json', 415);
    }
  }
}
