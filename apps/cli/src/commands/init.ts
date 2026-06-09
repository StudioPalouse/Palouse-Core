import { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Walk up from cwd to find the directory containing .env.example (repo root). */
function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, '.env.example'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function initCommand(): Command {
  return new Command('init')
    .description('Bootstrap a .env from .env.example with safe random secrets')
    .option('-f, --force', 'Overwrite an existing .env')
    .action((opts: { force?: boolean }) => {
      const root = findProjectRoot();
      const examplePath = resolve(root, '.env.example');
      const envPath = resolve(root, '.env');

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
