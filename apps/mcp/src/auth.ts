import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { eq } from 'drizzle-orm';
import { agents, auditEvents, type Database } from '@palouse/db';
import { agentService } from '@palouse/core';
import { agentKeyScope, unauthorized, type AgentKeyScope } from '@palouse/shared';
import { loadEnv } from '@palouse/config';

export type VerifiedAgentKey = agentService.VerifiedAgentKey;

const AGENT_KEY_PREFIX = 'palouse_agk_';

/** Issuer of MCP OAuth access tokens: the Better-Auth base URL on the API. */
export function oauthIssuer(): string {
  return `${loadEnv().BETTER_AUTH_URL}/api/auth`;
}

/** Audience access tokens must carry; also the resource in our RFC 9728 metadata. */
export function oauthAudience(): string {
  const env = loadEnv();
  return env.PUBLIC_MCP_URL ?? `http://localhost:${env.MCP_HTTP_PORT}/mcp`;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

/**
 * OAuth bearer path of the MCP connect flow (docs/PLAN-mcp-oauth.md): the
 * token is a JWT minted by our Better-Auth oauth-provider plugin, carrying the
 * agent/workspace the user pinned at consent. Signature, issuer, and audience
 * verify locally against the auth server's JWKS; the agent row is then checked
 * so archiving an agent revokes its OAuth connection just like its keys.
 */
async function verifyOAuthToken(db: Database, token: string): Promise<VerifiedAgentKey> {
  jwks ??= createRemoteJWKSet(new URL(`${oauthIssuer()}/jwks`));
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: oauthIssuer(),
      audience: oauthAudience(),
    }));
  } catch {
    throw unauthorized('Invalid or expired access token');
  }

  const agentId = payload.palouse_agent_id;
  const workspaceId = payload.palouse_workspace_id;
  if (typeof agentId !== 'string' || typeof workspaceId !== 'string') {
    throw unauthorized('Access token is not a Palouse MCP token');
  }

  const [agent] = await db
    .select({ id: agents.id, workspaceId: agents.workspaceId, archivedAt: agents.archivedAt })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent || agent.archivedAt || agent.workspaceId !== workspaceId) {
    throw unauthorized('This connection was revoked');
  }

  const scopes = String(payload.scope ?? '')
    .split(' ')
    .filter((s): s is AgentKeyScope => agentKeyScope.safeParse(s).success);

  return {
    agentId,
    workspaceId,
    // Synthetic id: OAuth connections have no agent_api_keys row. Nothing
    // persists keyId; it only distinguishes credentials in memory.
    keyId: `oauth:${typeof payload.azp === 'string' ? payload.azp : 'unknown'}`,
    scopes,
  };
}

/**
 * stdio transport: one key for the whole process, from PALOUSE_API_KEY
 * (set by the MCP config snippet `palouse create-agent-key` prints).
 */
export async function verifyKeyFromEnv(db: Database): Promise<VerifiedAgentKey> {
  const raw = process.env.PALOUSE_API_KEY;
  if (!raw) {
    throw unauthorized('PALOUSE_API_KEY is not set — mint one with `palouse create-agent-key`');
  }
  return agentService.verifyApiKey(db, raw);
}

/**
 * HTTP transport: `Authorization: Bearer <credential>` on every request. The
 * credential is either an agent API key (palouse_agk_...) or an OAuth access
 * token from the MCP connect flow; both resolve to the same shape.
 */
export async function verifyKeyFromHeader(
  db: Database,
  authorization: string | undefined,
): Promise<VerifiedAgentKey> {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw unauthorized('Missing Authorization: Bearer <agent api key or access token>');
  const credential = match[1]!;
  if (credential.startsWith(AGENT_KEY_PREFIX)) {
    return agentService.verifyApiKey(db, credential);
  }
  return verifyOAuthToken(db, credential);
}

const SENSITIVE_ARGS = new Set(['claimToken']);
const MAX_ARG_LENGTH = 500;

/**
 * Every successful tool call lands in the workspace audit log with
 * actor_type='agent'. Claim tokens never leave the payload-sanitizer; long
 * markdown bodies are truncated — the full text lives on the task/handoff row.
 */
export async function auditToolCall(
  db: Database,
  key: VerifiedAgentKey,
  tool: string,
  args: Record<string, unknown>,
): Promise<void> {
  const payload: Record<string, unknown> = { tool };
  for (const [name, value] of Object.entries(args)) {
    if (value === undefined || SENSITIVE_ARGS.has(name)) continue;
    payload[name] =
      typeof value === 'string' && value.length > MAX_ARG_LENGTH
        ? `${value.slice(0, MAX_ARG_LENGTH)}…`
        : value;
  }
  await db.insert(auditEvents).values({
    workspaceId: key.workspaceId,
    actorType: 'agent',
    actorId: key.agentId,
    action: `mcp.${tool}`,
    targetType: 'agent',
    targetId: key.agentId,
    payload,
  });
}
