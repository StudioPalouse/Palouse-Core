import pino from 'pino';
import { loadEnv } from '@reqops/config';

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL, base: { service: 'reqops-worker' } });

logger.info('ReqOps worker booting (M1 stub — sync workers land in M3)');

// Keep the process alive so docker-compose can supervise it during M1.
setInterval(() => logger.debug('worker heartbeat'), 60_000);

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
