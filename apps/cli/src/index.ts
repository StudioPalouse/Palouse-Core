#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import { migrateCommand } from './commands/migrate.js';
import { seedCommand } from './commands/seed.js';
import { createAgentCommand } from './commands/create-agent.js';
import { createAgentKeyCommand } from './commands/create-agent-key.js';

const program = new Command();

program
  .name('reqops')
  .description('ReqOps self-host CLI')
  .version('0.0.0');

program.addCommand(initCommand());
program.addCommand(doctorCommand());
program.addCommand(migrateCommand());
program.addCommand(seedCommand());
program.addCommand(createAgentCommand());
program.addCommand(createAgentKeyCommand());

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
