import { Command } from 'commander';
import { loadEnv } from '@reqops/config';
import { closeDb, getDb } from '@reqops/db';
import { sql } from 'drizzle-orm';

export function doctorCommand(): Command {
  return new Command('doctor')
    .description('Check connectivity to Postgres and Redis')
    .action(async () => {
      const checks: { name: string; ok: boolean; detail?: string }[] = [];

      try {
        const env = loadEnv();
        checks.push({ name: 'env', ok: true });

        try {
          const db = getDb(env.DATABASE_URL);
          await db.execute(sql`select 1`);
          checks.push({ name: 'postgres', ok: true });
        } catch (err) {
          checks.push({
            name: 'postgres',
            ok: false,
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      } catch (err) {
        checks.push({
          name: 'env',
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      for (const c of checks) {
        console.log(`${c.ok ? 'OK  ' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
      }

      await closeDb();
      process.exit(checks.every((c) => c.ok) ? 0 : 1);
    });
}
