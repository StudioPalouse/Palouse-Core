import { Command } from 'commander';
import { loadEnv } from '@palouse/config';
import { closeDb, getDb, workspaces } from '@palouse/db';
import { verifyChain } from '@palouse/core';

/**
 * Re-walk the audit hash chain and report whether it verifies. Exits non-zero
 * if any checked workspace fails, so CI or a cron can gate on it. Backs the same
 * check as GET /v1/audit/verify.
 */
export function verifyAuditCommand(): Command {
  return new Command('verify-audit')
    .description('Verify the tamper-evident audit hash chain for one or all workspaces')
    .option('-w, --workspace <workspaceId>', 'Verify a single workspace instead of all')
    .action(async (opts: { workspace?: string }) => {
      const env = loadEnv();
      const db = getDb(env.DATABASE_URL);
      try {
        const targets = opts.workspace
          ? [{ id: opts.workspace, slug: opts.workspace }]
          : await db.select({ id: workspaces.id, slug: workspaces.slug }).from(workspaces);

        let anyBroken = false;
        for (const ws of targets) {
          const r = await verifyChain(db, ws.id);
          if (r.valid) {
            const tail = r.unchainedCount > 0 ? `, ${r.unchainedCount} awaiting backfill` : '';
            console.log(
              `OK   ${ws.slug}: ${r.checkedCount} entries, head seq ${r.headSeq ?? 0}${tail}`,
            );
          } else {
            anyBroken = true;
            console.error(`FAIL ${ws.slug}: chain breaks at entry #${r.firstBrokenSeq}`);
          }
        }
        process.exitCode = anyBroken ? 1 : 0;
      } finally {
        await closeDb();
      }
    });
}
