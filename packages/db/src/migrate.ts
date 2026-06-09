import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadEnv } from '@reqops/config';

// loadEnv picks up the repo-root .env in dev; real env vars win in containers.
const databaseUrl = loadEnv().DATABASE_URL;

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

try {
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './migrations' });
  console.log('Migrations complete');
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
} finally {
  await client.end();
}
