import { createMiddleware } from 'hono/factory';
import { unauthorized } from '@reqops/shared';
import { getAuth } from '@reqops/auth';

export type SessionVars = {
  Variables: {
    userId: string;
    userEmail: string;
  };
};

/** Resolves the Better-Auth session cookie and exposes the user on context. */
export const requireSession = createMiddleware<SessionVars>(async (c, next) => {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw unauthorized();
  c.set('userId', session.user.id);
  c.set('userEmail', session.user.email);
  await next();
});
