import { Command } from 'commander';
import { loadEnv } from '@palouse/config';
import { backfillAuditChain, closeDb, getDb } from '@palouse/db';

/**
 * Chain any historical audit_events rows that predate the hash chain (or were
 * written during a deploy window). Idempotent, so it is safe to re-run. This is
 * run automatically at the end of `palouse migrate`; this command exposes it for
 * manual sweeps.
 */
export function backfillAuditChainCommand(): Command {
  return new Command('backfill-audit-chain')
    .description('Chain historical audit_events rows (seq/prev_hash/hash). Idempotent.')
    .action(async () => {
      const env = loadEnv();
      const db = getDb(env.DATABASE_URL);
      try {
        const result = await backfillAuditChain(db);
        console.log(
          `Chained ${result.rowsChained} row${result.rowsChained === 1 ? '' : 's'} across ${result.workspaces} workspace${result.workspaces === 1 ? '' : 's'}.`,
        );
      } finally {
        await closeDb();
      }
    });
}
