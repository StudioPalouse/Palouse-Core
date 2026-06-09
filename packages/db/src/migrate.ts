import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

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
