import { Command } from 'commander';
import { eq } from 'drizzle-orm';
import { loadEnv } from '@reqops/config';
import { closeDb, getDb, users, workspaces } from '@reqops/db';
import { agentService } from '@reqops/core';
import { agentKind } from '@reqops/shared';

/**
 * Resolves --workspace as a slug. Mutations need an actor for the audit log;
 * the CLI runs as the first system/admin user unless --actor-email is given.
 */
export async function resolveWorkspaceAndActor(
  db: ReturnType<typeof getDb>,
  workspaceSlug: string,
  actorEmail?: string,
): Promise<{ workspaceId: string; actorUserId: string }> {
  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1);
  if (!ws) throw new Error(`Workspace not found: ${workspaceSlug}`);

  const [actor] = actorEmail
    ? await db.select({ id: users.id }).from(users).where(eq(users.email, actorEmail)).limit(1)
    : await db.select({ id: users.id }).from(users).orderBy(users.createdAt).limit(1);
  if (!actor) throw new Error(actorEmail ? `User not found: ${actorEmail}` : 'No users exist yet');
  return { workspaceId: ws.id, actorUserId: actor.id };
}

export function createAgentCommand(): Command {
  return new Command('create-agent')
    .description('Create an agent identity in a workspace')
    .argument('<name>', 'agent display name')
    .requiredOption('-w, --workspace <slug>', 'workspace slug')
    .option('-k, --kind <kind>', `agent kind: ${agentKind.options.join(' | ')}`, 'mcp_generic')
    .option('--actor-email <email>', 'user recorded as creator in the audit log')
    .action(async (name: string, opts: { workspace: string; kind: string; actorEmail?: string }) => {
      const kind = agentKind.parse(opts.kind);
      const db = getDb(loadEnv().DATABASE_URL);
      try {
        const { workspaceId, actorUserId } = await resolveWorkspaceAndActor(
          db,
          opts.workspace,
          opts.actorEmail,
        );
        const agent = await agentService.createAgent(db, workspaceId, actorUserId, {
          name,
          kind,
          metadata: {},
        });
        console.log(`Agent created: ${agent.name} (${agent.id})`);
        console.log(`Next: reqops create-agent-key ${agent.id} --workspace ${opts.workspace}`);
      } finally {
        await closeDb();
      }
    });
}
