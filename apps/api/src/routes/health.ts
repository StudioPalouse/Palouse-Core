import { Hono } from 'hono';
import { loadEnv } from '@palouse/config';
import { getDb } from '@palouse/db';
import { sql } from 'drizzle-orm';

export const health = new Hono();

health.get('/', (c) =>
  c.json({
    status: 'ok',
    uptime: process.uptime(),
    version: process.env.npm_package_version ?? '0.0.0',
  }),
);

health.get('/ready', async (c) => {
  const env = loadEnv();
  const db = getDb(env.DATABASE_URL);
  try {
    await db.execute(sql`select 1`);
    return c.json({ status: 'ready' });
  } catch (err) {
    return c.json(
      { status: 'unready', reason: err instanceof Error ? err.message : 'unknown' },
      503,
    );
  }
});
