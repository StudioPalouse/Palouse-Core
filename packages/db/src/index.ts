import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export * from './schema/index.js';
export * from './seed/model-prices.js';

export type Database = PostgresJsDatabase<typeof schema>;

let cachedDb: Database | undefined;
let cachedClient: ReturnType<typeof postgres> | undefined;

export function getDb(databaseUrl: string): Database {
  if (cachedDb) return cachedDb;
  cachedClient = postgres(databaseUrl, { max: 10, prepare: false });
  cachedDb = drizzle(cachedClient, { schema });
  return cachedDb;
}

export async function closeDb(): Promise<void> {
  if (cachedClient) {
    await cachedClient.end({ timeout: 5 });
    cachedClient = undefined;
    cachedDb = undefined;
  }
}
