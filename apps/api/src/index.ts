import { serve } from '@hono/node-server';
import { loadEnv } from '@reqops/config';
import { buildApp } from './app.js';
import { logger } from './logger.js';

const env = loadEnv();
const app = buildApp();

const server = serve(
  {
    fetch: app.fetch,
    port: env.API_PORT,
  },
  (info) => {
    logger.info({ port: info.port }, 'ReqOps API listening');
  },
);

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
