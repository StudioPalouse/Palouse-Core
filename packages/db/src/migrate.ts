import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadEnv } from '@reqops/config';
import { seedModelPrices, CATALOG_VERSION } from './seed/model-prices.js';
import type { Database } from './index.js';

// loadEnv picks up the repo-root .env in dev; real env vars win in containers.
const databaseUrl = loadEnv().DATABASE_URL;

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

try {
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './migrations' });
  console.log('Migrations complete');
  // Keep the built-in price catalog current on every deploy; idempotent, so
  // an unchanged catalog is a no-op.
  const seeded = await seedModelPrices(db as unknown as Database);
  console.log(
    `Model price catalog ${CATALOG_VERSION}: ${seeded.inserted} inserted, ${seeded.superseded} superseded, ${seeded.unchanged} unchanged`,
  );
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
} finally {
  await client.end();
}
