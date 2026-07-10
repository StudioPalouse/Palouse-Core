import { createMiddleware } from 'hono/factory';
import { unauthorized } from '@palouse/shared';
import { getAuth } from '@palouse/auth';
import { assertBrowserSafe } from './request-guards.js';

export type SessionVars = {
  Variables: {
    userId: string;
    userEmail: string;
  };
};

/** Resolves the Better-Auth session cookie and exposes the user on context. */
export const requireSession = createMiddleware<SessionVars>(async (c, next) => {
  // Cross-origin / content-type check runs before we trust the session cookie.
  assertBrowserSafe(c);
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw unauthorized();
  c.set('userId', session.user.id);
  c.set('userEmail', session.user.email);
  await next();
});
