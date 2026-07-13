import { Hono } from 'hono';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { notFound, unauthorized, validation } from '@palouse/shared';
import { agentService, appendAuditEvent, workspaces } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import {
  agents,
  getDb,
  mcpConnectSelections,
  oauthClients,
  workspaces as workspacesTable,
} from '@palouse/db';
import { getAuth } from '@palouse/auth';

const selectionInput = z.object({
  workspaceId: z.string().uuid(),
  clientId: z.string().min(1),
});

/**
 * The workspace-selection step of the MCP OAuth connect flow
 * (docs/PLAN-mcp-oauth.md). The /mcp-connect/workspace page posts the chosen
 * workspace here before calling /oauth2/continue; the oauthProvider plugin's
 * consentReferenceId callback then reads the stored selection back by session.
 *
 * Selecting a workspace finds-or-creates the agent record for this OAuth
 * client in that workspace, so the connection lands in the same agent
 * directory, audit trail, and capability gates as key-based agents.
 */
export const mcpConnectRoutes = new Hono();

// The consent page reads this back to tell the user which workspace the
// client is being connected to.
mcpConnectRoutes.get('/selection', async (c) => {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw unauthorized();

  const db = getDb(loadEnv().DATABASE_URL);
  const [row] = await db
    .select({
      workspaceId: mcpConnectSelections.workspaceId,
      workspaceName: workspacesTable.name,
      agentId: mcpConnectSelections.agentId,
      clientId: mcpConnectSelections.oauthClientId,
    })
    .from(mcpConnectSelections)
    .innerJoin(workspacesTable, eq(mcpConnectSelections.workspaceId, workspacesTable.id))
    .where(eq(mcpConnectSelections.sessionId, session.session.id))
    .limit(1);
  return c.json({ selection: row ?? null });
});

mcpConnectRoutes.post('/selection', async (c) => {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw unauthorized();

  const parsed = selectionInput.safeParse(await c.req.json());
  if (!parsed.success) throw validation('Invalid selection input', parsed.error.flatten());
  const { workspaceId, clientId } = parsed.data;

  const db = getDb(loadEnv().DATABASE_URL);
  // Same bar as minting an agent key by hand.
  await workspaces.requireRole(db, workspaceId, session.user.id, ['owner', 'admin']);

  const [client] = await db
    .select({ clientId: oauthClients.clientId, name: oauthClients.name })
    .from(oauthClients)
    .where(and(eq(oauthClients.clientId, clientId), eq(oauthClients.disabled, false)))
    .limit(1);
  if (!client) throw notFound('Unknown OAuth client');

  // One agent per (workspace, OAuth client); reconnects reuse it so history
  // stays attached. Archived agents stay revoked; reconnecting creates a
  // fresh agent rather than silently reviving the old one.
  const [existing] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.workspaceId, workspaceId),
        isNull(agents.archivedAt),
        sql`${agents.metadata}->>'oauthClientId' = ${clientId}`,
      ),
    )
    .limit(1);

  const agentId = existing
    ? existing.id
    : (
        await agentService.createAgent(db, workspaceId, session.user.id, {
          name: client.name ?? 'MCP client',
          kind: 'mcp_generic',
          metadata: { oauthClientId: clientId, connectedByUserId: session.user.id },
        })
      ).id;

  await db
    .insert(mcpConnectSelections)
    .values({
      sessionId: session.session.id,
      userId: session.user.id,
      workspaceId,
      agentId,
      oauthClientId: clientId,
    })
    .onConflictDoUpdate({
      target: mcpConnectSelections.sessionId,
      set: {
        userId: session.user.id,
        workspaceId,
        agentId,
        oauthClientId: clientId,
        updatedAt: new Date(),
      },
    });

  await appendAuditEvent(db, {
    workspaceId,
    actorType: 'user',
    actorId: session.user.id,
    action: 'agent.oauth_workspace_selected',
    targetType: 'agent',
    targetId: agentId,
    payload: { clientId, clientName: client.name ?? null },
  });

  return c.json({ agentId });
});
