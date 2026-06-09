import pino from 'pino';
import { loadEnv } from '@reqops/config';

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL, base: { service: 'reqops-mcp' } });

// Full MCP server (tools + resources) is implemented in M5.
// For now we keep the process alive so the OSS compose stack stays whole.
logger.info(
  { port: env.MCP_HTTP_PORT },
  'ReqOps MCP server placeholder — tools land in M5 per docs/architecture.md',
);

setInterval(() => logger.debug('mcp heartbeat'), 60_000);

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
