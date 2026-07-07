import { randomBytes } from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import {
  agentApiKeys,
  agentHandoffs,
  agents,
  auditEvents,
  decisions,
  oauthAccessTokens,
  oauthConsents,
  oauthRefreshTokens,
  tasks,
  usageRollupsDaily,
  type Database,
} from '@palouse/db';
import {
  conflict,
  notFound,
  unauthorized,
  WILDCARD_SCOPE,
  type Agent,
  type AgentApiKey,
  type AgentKeyScope,
  type CreateAgentInput,
  type CreateAgentKeyInput,
} from '@palouse/shared';

const KEY_PREFIX = 'palouse_agk';

function toDto(row: typeof agents.$inferSelect): Agent {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    kind: row.kind,
    metadata: row.metadata,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function keyToDto(row: typeof agentApiKeys.$inferSelect): AgentApiKey {
  return {
    id: row.id,
    agentId: row.agentId,
    prefix: row.prefix,
    scopes: row.scopes as AgentKeyScope[],
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createAgent(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  input: CreateAgentInput,
): Promise<Agent> {
  const [row] = await db
    .insert(agents)
    .values({
      workspaceId,
      name: input.name,
      kind: input.kind,
      metadata: input.metadata,
    })
    .returning();
  await audit(db, workspaceId, actorUserId, 'agent.created', row!.id, { name: input.name });
  return toDto(row!);
}

export async function listAgents(
  db: Database,
  workspaceId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<Agent[]> {
  const rows = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.workspaceId, workspaceId),
        opts.includeArchived ? undefined : isNull(agents.archivedAt),
      ),
    )
    .orderBy(desc(agents.createdAt));
  return rows.map(toDto);
}

export async function getAgent(
  db: Database,
  workspaceId: string,
  agentId: string,
): Promise<{ agent: Agent; keys: AgentApiKey[] }> {
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw notFound('Agent not found');
  const keys = await db
    .select()
    .from(agentApiKeys)
    .where(eq(agentApiKeys.agentId, agentId))
    .orderBy(desc(agentApiKeys.createdAt));
  return { agent: toDto(row), keys: keys.map(keyToDto) };
}

/**
 * Archives an agent: hides it from the default list and revokes every way it
 * can authenticate. For key-based agents that means revoking their API keys;
 * for agents connected over OAuth (MCP sign-in) it means clearing their stored
 * grants so no client can mint a fresh token and a reconnect needs consent
 * again (the stateless access-token JWT is already refused once the agent is
 * archived). History (handoffs, spend, tasks and decisions it created) is kept
 * and stays attributed to it.
 */
export async function archiveAgent(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  agentId: string,
): Promise<Agent> {
  const [row] = await db
    .update(agents)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId), isNull(agents.archivedAt)),
    )
    .returning();
  if (!row) throw notFound('Agent not found');
  const revoked = await db
    .update(agentApiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(agentApiKeys.agentId, agentId), isNull(agentApiKeys.revokedAt)))
    .returning({ id: agentApiKeys.id });
  // OAuth grants are keyed by referenceId = agentId. Deleting the refresh
  // token cascades its access tokens; the consent is dropped so reconnecting
  // asks the user to approve again.
  await db.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.referenceId, agentId));
  await db.delete(oauthAccessTokens).where(eq(oauthAccessTokens.referenceId, agentId));
  await db.delete(oauthConsents).where(eq(oauthConsents.referenceId, agentId));
  await audit(db, workspaceId, actorUserId, 'agent.archived', agentId, {
    revokedKeyIds: revoked.map((k) => k.id),
  });
  return toDto(row);
}

/**
 * Restores an archived agent. Keys revoked by the archive stay revoked; the
 * caller mints a fresh key to reconnect.
 */
export async function unarchiveAgent(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  agentId: string,
): Promise<Agent> {
  const [row] = await db
    .update(agents)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .returning();
  if (!row) throw notFound('Agent not found');
  await audit(db, workspaceId, actorUserId, 'agent.unarchived', agentId);
  return toDto(row);
}

/**
 * Hard-deletes an agent that has never done anything: no handoffs, no usage,
 * and no tasks or decisions attributed to it. Agents with history must be
 * archived instead so attribution and spend records survive.
 */
export async function deleteAgent(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  agentId: string,
): Promise<void> {
  const [agent] = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .limit(1);
  if (!agent) throw notFound('Agent not found');

  const refCounts = await Promise.all([
    db.select({ n: count() }).from(agentHandoffs).where(eq(agentHandoffs.actorAgentId, agentId)),
    db.select({ n: count() }).from(tasks).where(eq(tasks.createdByAgentId, agentId)),
    db.select({ n: count() }).from(decisions).where(eq(decisions.createdByAgentId, agentId)),
    db.select({ n: count() }).from(usageRollupsDaily).where(eq(usageRollupsDaily.agentId, agentId)),
  ]);
  if (refCounts.some(([row]) => (row?.n ?? 0) > 0)) {
    throw conflict(
      'This agent has recorded activity and cannot be deleted. Archive it instead to keep its history.',
    );
  }

  // OAuth grants reference the agent by a bare text id (no FK), so clear them
  // explicitly. Keys cascade with the agent row.
  await db.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.referenceId, agentId));
  await db.delete(oauthAccessTokens).where(eq(oauthAccessTokens.referenceId, agentId));
  await db.delete(oauthConsents).where(eq(oauthConsents.referenceId, agentId));
  await db.delete(agents).where(eq(agents.id, agentId));
  await audit(db, workspaceId, actorUserId, 'agent.deleted', agentId, { name: agent.name });
}

/**
 * Mints `palouse_agk_<prefix>_<secret>`; the plaintext is returned exactly once
 * and only the Argon2id hash of the secret is stored.
 */
export async function createApiKey(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  agentId: string,
  input: CreateAgentKeyInput,
): Promise<{ key: AgentApiKey; plaintext: string }> {
  const [agent] = await db
    .select({ id: agents.id, archivedAt: agents.archivedAt })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .limit(1);
  if (!agent) throw notFound('Agent not found');
  if (agent.archivedAt) throw conflict('This agent is archived. Restore it to create new keys.');

  const prefix = randomBytes(6).toString('base64url').slice(0, 8);
  const secret = randomBytes(32).toString('hex');
  const plaintext = `${KEY_PREFIX}_${prefix}_${secret}`;
  const digest = await argon2Hash(secret);

  // A wildcard grant subsumes any granular scopes, so store it alone to keep the
  // row unambiguous ('*' means all current and future scopes).
  const scopes: AgentKeyScope[] = input.scopes.includes(WILDCARD_SCOPE)
    ? [WILDCARD_SCOPE]
    : input.scopes;

  const [row] = await db
    .insert(agentApiKeys)
    .values({ agentId, prefix, hash: digest, scopes })
    .returning();
  await audit(db, workspaceId, actorUserId, 'agent.key_created', agentId, {
    keyId: row!.id,
    scopes,
  });
  return { key: keyToDto(row!), plaintext };
}

export async function revokeApiKey(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  agentId: string,
  keyId: string,
): Promise<void> {
  const [row] = await db
    .update(agentApiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(agentApiKeys.id, keyId),
        eq(agentApiKeys.agentId, agentId),
        isNull(agentApiKeys.revokedAt),
      ),
    )
    .returning({ id: agentApiKeys.id, agentId: agentApiKeys.agentId });
  if (!row) throw notFound('API key not found');
  const [agent] = await db
    .select({ workspaceId: agents.workspaceId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent || agent.workspaceId !== workspaceId) throw notFound('Agent not found');
  await audit(db, workspaceId, actorUserId, 'agent.key_revoked', agentId, { keyId });
}

export interface VerifiedAgentKey {
  agentId: string;
  workspaceId: string;
  keyId: string;
  scopes: AgentKeyScope[];
}

// Argon2 verification is deliberately slow; cache successes so MCP/OTLP calls
// don't pay it per request. Entries expire after 5 minutes or on revocation
// (revoked keys may live up to the TTL — acceptable for v1).
const verifyCache = new Map<string, { value: VerifiedAgentKey; expiresAt: number }>();
const VERIFY_CACHE_TTL_MS = 5 * 60_000;

export async function verifyApiKey(db: Database, rawKey: string): Promise<VerifiedAgentKey> {
  const cached = verifyCache.get(rawKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const parts = rawKey.split('_');
  // palouse_agk_<prefix>_<secret>
  if (parts.length !== 4 || `${parts[0]}_${parts[1]}` !== KEY_PREFIX) {
    throw unauthorized('Malformed agent API key');
  }
  const [, , prefix, secret] = parts;

  const candidates = await db
    .select({
      id: agentApiKeys.id,
      agentId: agentApiKeys.agentId,
      hash: agentApiKeys.hash,
      scopes: agentApiKeys.scopes,
      workspaceId: agents.workspaceId,
    })
    .from(agentApiKeys)
    .innerJoin(agents, eq(agents.id, agentApiKeys.agentId))
    // Archiving revokes keys, but filter on the agent too so an archived agent
    // can never authenticate regardless.
    .where(
      and(
        eq(agentApiKeys.prefix, prefix!),
        isNull(agentApiKeys.revokedAt),
        isNull(agents.archivedAt),
      ),
    );

  for (const candidate of candidates) {
    if (await argon2Verify(candidate.hash, secret!)) {
      const value: VerifiedAgentKey = {
        agentId: candidate.agentId,
        workspaceId: candidate.workspaceId,
        keyId: candidate.id,
        scopes: candidate.scopes as AgentKeyScope[],
      };
      verifyCache.set(rawKey, { value, expiresAt: Date.now() + VERIFY_CACHE_TTL_MS });
      // Throttled touch: fire-and-forget, at most once per cache window.
      void db
        .update(agentApiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(agentApiKeys.id, candidate.id))
        .catch(() => {});
      return value;
    }
  }
  throw unauthorized('Invalid agent API key');
}

/** Whether a key satisfies a scope, honouring the wildcard (full-access) grant. */
export function hasScope(key: VerifiedAgentKey, scope: AgentKeyScope): boolean {
  return key.scopes.includes(WILDCARD_SCOPE) || key.scopes.includes(scope);
}

export function requireScope(key: VerifiedAgentKey, scope: AgentKeyScope): void {
  if (!hasScope(key, scope)) {
    throw unauthorized(`Agent key missing required scope: ${scope}`);
  }
}

async function audit(
  db: Database,
  workspaceId: string,
  userId: string,
  action: string,
  targetId: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(auditEvents).values({
    workspaceId,
    actorType: 'user',
    actorId: userId,
    action,
    targetType: 'agent',
    targetId,
    payload,
  });
}
