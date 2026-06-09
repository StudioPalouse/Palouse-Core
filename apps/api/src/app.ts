import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ReqOpsError } from '@reqops/shared';
import { getAuth } from '@reqops/auth';
import { loadEnv } from '@reqops/config';
import { health } from './routes/health.js';
import { logger } from './logger.js';

export function buildApp() {
  const env = loadEnv();
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: [env.WEB_BASE_URL],
      credentials: true,
    }),
  );

  app.onError((err, c) => {
    if (err instanceof ReqOpsError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    }
    logger.error({ err }, 'Unhandled error');
    return c.json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, 500);
  });

  app.route('/health', health);

  // Better-Auth mounts /api/auth/* — see https://better-auth.com/docs
  const auth = getAuth();
  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  // Placeholder for later milestones
  app.get('/v1', (c) => c.json({ name: 'reqops', version: '0.0.0' }));

  return app;
}
