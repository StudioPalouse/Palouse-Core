import { Command } from 'commander';
import { spawnSync } from 'node:child_process';

export function migrateCommand(): Command {
  return new Command('migrate')
    .description('Run pending database migrations')
    .action(() => {
      const result = spawnSync('pnpm', ['--filter', '@reqops/db', 'migrate'], {
        stdio: 'inherit',
      });
      process.exit(result.status ?? 1);
    });
}
