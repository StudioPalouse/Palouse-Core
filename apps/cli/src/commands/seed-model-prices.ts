import { Command } from 'commander';
import { loadEnv } from '@reqops/config';
import { CATALOG_VERSION, closeDb, getDb, seedModelPrices } from '@reqops/db';

export function seedModelPricesCommand(): Command {
  return new Command('seed-model-prices')
    .description(
      'Seed or upgrade the built-in model price catalog (idempotent; superseded rows are closed, never mutated)',
    )
    .action(async () => {
      const env = loadEnv();
      const db = getDb(env.DATABASE_URL);
      const result = await seedModelPrices(db);
      console.log(`Model price catalog ${CATALOG_VERSION}`);
      console.log(`  inserted:   ${result.inserted}`);
      console.log(`  superseded: ${result.superseded}`);
      console.log(`  unchanged:  ${result.unchanged}`);
      await closeDb();
    });
}
