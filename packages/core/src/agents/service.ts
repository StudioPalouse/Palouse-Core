import { randomBytes } from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { agentApiKeys, agents, auditEvents, type Database } from '@palouse/db';
import {
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

export async function listAgents(db: Database, workspaceId: string): Promise<Agent[]> {
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, workspaceId))
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
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .limit(1);
  if (!agent) throw notFound('Agent not found');

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
    .where(and(eq(agentApiKeys.prefix, prefix!), isNull(agentApiKeys.revokedAt)));

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
