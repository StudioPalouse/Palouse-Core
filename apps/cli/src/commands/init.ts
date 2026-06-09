import { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function initCommand(): Command {
  return new Command('init')
    .description('Bootstrap a .env from .env.example with safe random secrets')
    .option('-f, --force', 'Overwrite an existing .env')
    .action((opts: { force?: boolean }) => {
      const cwd = process.cwd();
      const examplePath = resolve(cwd, '.env.example');
      const envPath = resolve(cwd, '.env');

      if (!existsSync(examplePath)) {
        console.error(`No .env.example found at ${examplePath}`);
        process.exit(1);
      }
      if (existsSync(envPath) && !opts.force) {
        console.error(`.env already exists at ${envPath} (use --force to overwrite)`);
        process.exit(1);
      }

      const template = readFileSync(examplePath, 'utf8');
      const filled = template
        .replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET=${randomBytes(32).toString('base64')}`)
        .replace(/^REQOPS_ENCRYPTION_KEY=.*$/m, `REQOPS_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`);

      writeFileSync(envPath, filled);
      console.log(`Wrote ${envPath}`);
      console.log('Next: `docker compose up` to start the stack.');
    });
}
