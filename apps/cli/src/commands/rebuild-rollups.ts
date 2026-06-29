import { Command } from 'commander';
import { loadEnv } from '@palouse/config';
import { closeDb, getDb } from '@palouse/db';
import { usageService } from '@palouse/core';

export function rebuildRollupsCommand(): Command {
  return new Command('rebuild-rollups')
    .description(
      'Escape hatch: truncate usage_rollups_daily and re-aggregate it from the llm_generations ledger',
    )
    .option('-w, --workspace <workspaceId>', 'Limit the rebuild to one workspace')
    .action(async (opts: { workspace?: string }) => {
      const env = loadEnv();
      const db = getDb(env.DATABASE_URL);
      const count = await usageService.rebuildRollups(db, opts.workspace);
      console.log(`Rebuilt ${count} rollup row${count === 1 ? '' : 's'}.`);
      await closeDb();
    });
}
