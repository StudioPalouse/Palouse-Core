#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import { migrateCommand } from './commands/migrate.js';
import { seedCommand } from './commands/seed.js';

const program = new Command();

program
  .name('reqops')
  .description('ReqOps self-host CLI')
  .version('0.0.0');

program.addCommand(initCommand());
program.addCommand(doctorCommand());
program.addCommand(migrateCommand());
program.addCommand(seedCommand());

// Stubs reserved for M5
program
  .command('create-agent <name>')
  .description('(M5) Create an agent identity in a workspace')
  .action(() => {
    console.error('create-agent lands in M5 — see docs/architecture.md');
    process.exit(2);
  });

program
  .command('create-agent-key <agent>')
  .description('(M5) Mint an API key for an agent')
  .action(() => {
    console.error('create-agent-key lands in M5 — see docs/architecture.md');
    process.exit(2);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
