import pino from 'pino';
import { loadEnv } from '@palouse/config';

const env = loadEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'palouse-api' },
});
