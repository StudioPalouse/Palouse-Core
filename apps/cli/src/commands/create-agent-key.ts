import { Command } from 'commander';
import { and, eq, or } from 'drizzle-orm';
import { loadEnv } from '@palouse/config';
import { agents, closeDb, getDb } from '@palouse/db';
import { agentService } from '@palouse/core';
import { agentKeyScope, ALL_AGENT_KEY_SCOPES, uuid as uuidSchema } from '@palouse/shared';
import { resolveWorkspaceAndActor } from './create-agent.js';

export function createAgentKeyCommand(): Command {
  return new Command('create-agent-key')
    .description('Mint an API key for an agent (plaintext shown exactly once)')
    .argument('<agent>', 'agent id or name')
    .requiredOption('-w, --workspace <slug>', 'workspace slug')
    .option('-s, --scopes <scopes>', `comma-separated: ${ALL_AGENT_KEY_SCOPES.join(',')}`)
    .option('--actor-email <email>', 'user recorded as creator in the audit log')
    .action(
      async (agentRef: string, opts: { workspace: string; scopes?: string; actorEmail?: string }) => {
        const scopes = opts.scopes
          ? opts.scopes.split(',').map((s) => agentKeyScope.parse(s.trim()))
          : [...ALL_AGENT_KEY_SCOPES];
        const env = loadEnv();
        const db = getDb(env.DATABASE_URL);
        try {
          const { workspaceId, actorUserId } = await resolveWorkspaceAndActor(
            db,
            opts.workspace,
            opts.actorEmail,
          );
          const byId = uuidSchema.safeParse(agentRef).success;
          const [agent] = await db
            .select({ id: agents.id, name: agents.name })
            .from(agents)
            .where(
              and(
                eq(agents.workspaceId, workspaceId),
                byId ? or(eq(agents.id, agentRef), eq(agents.name, agentRef)) : eq(agents.name, agentRef),
              ),
            )
            .limit(1);
          if (!agent) throw new Error(`Agent not found in workspace: ${agentRef}`);

          const { key, plaintext } = await agentService.createApiKey(
            db,
            workspaceId,
            actorUserId,
            agent.id,
            { scopes },
          );

          console.log(`API key for ${agent.name} (key id ${key.id}). Shown once, store it now:`);
          console.log(`\n  ${plaintext}\n`);
          // Distinct client alias per environment, so connecting staging and
          // prod side by side does not collide in the local MCP config.
          const alias = (env.PUBLIC_MCP_URL ?? '').includes('mcp-test.')
            ? 'palouse-test'
            : 'palouse';
          if (env.PUBLIC_MCP_URL) {
            console.log('Connect Claude Code:');
            console.log(
              `\n  claude mcp add --transport http ${alias} ${env.PUBLIC_MCP_URL} --header "Authorization: Bearer ${plaintext}"\n`,
            );
            console.log('Other MCP clients (HTTP):');
            console.log(
              JSON.stringify(
                {
                  mcpServers: {
                    [alias]: {
                      type: 'http',
                      url: env.PUBLIC_MCP_URL,
                      headers: { Authorization: `Bearer ${plaintext}` },
                    },
                  },
                },
                null,
                2,
              ),
            );
            console.log('\nOr run the server locally over stdio (needs DATABASE_URL):');
          } else {
            console.log('MCP config snippet (stdio, runs next to the database):');
          }
          console.log(
            JSON.stringify(
              {
                mcpServers: {
                  [alias]: {
                    command: 'palouse-mcp',
                    args: ['--stdio'],
                    env: { PALOUSE_API_KEY: plaintext },
                  },
                },
              },
              null,
              2,
            ),
          );
        } finally {
          await closeDb();
        }
      },
    );
}
