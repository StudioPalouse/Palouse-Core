import { auditEvents, type Database } from '@reqops/db';
import { agentService } from '@reqops/core';
import { unauthorized } from '@reqops/shared';

export type VerifiedAgentKey = agentService.VerifiedAgentKey;

/**
 * stdio transport: one key for the whole process, from REQOPS_API_KEY
 * (set by the MCP config snippet `reqops create-agent-key` prints).
 */
export async function verifyKeyFromEnv(db: Database): Promise<VerifiedAgentKey> {
  const raw = process.env.REQOPS_API_KEY;
  if (!raw) {
    throw unauthorized('REQOPS_API_KEY is not set — mint one with `reqops create-agent-key`');
  }
  return agentService.verifyApiKey(db, raw);
}

/** HTTP transport: `Authorization: Bearer reqops_agk_...` on every request. */
export async function verifyKeyFromHeader(
  db: Database,
  authorization: string | undefined,
): Promise<VerifiedAgentKey> {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw unauthorized('Missing Authorization: Bearer <agent api key>');
  return agentService.verifyApiKey(db, match[1]!);
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
