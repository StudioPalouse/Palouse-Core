import pino from 'pino';
import { loadEnv } from '@reqops/config';

const env = loadEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'reqops-api' },
});
