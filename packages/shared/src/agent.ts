import { z } from 'zod';
import { uuid } from './ids.js';

export const agentKind = z.enum(['mcp_generic', 'paperclip', 'claude_code', 'custom']);
export type AgentKind = z.infer<typeof agentKind>;

export const agentKeyScope = z.enum([
  'tasks:read',
  'tasks:write',
  'decisions:read',
  'decisions:write',
  'objectives:read',
  'objectives:write',
  'projects:read',
  'projects:write',
  'handoffs:claim',
  'handoffs:complete',
  'usage:write',
  // Wildcard grant: a key holding it satisfies every current AND future scope,
  // so new capabilities/tools become usable on the existing key with no
  // re-mint. Granted as "full access", not offered as a granular checkbox.
  '*',
]);
export type AgentKeyScope = z.infer<typeof agentKeyScope>;

export const WILDCARD_SCOPE = '*' as const;

/**
 * Granular scopes offered in the key-creation picker. Excludes the wildcard,
 * which is granted as full access rather than picked à la carte.
 */
export const ALL_AGENT_KEY_SCOPES = agentKeyScope.options.filter(
  (s): s is Exclude<AgentKeyScope, typeof WILDCARD_SCOPE> => s !== WILDCARD_SCOPE,
);

export const agentSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  name: z.string(),
  kind: agentKind,
  metadata: z.record(z.string(), z.unknown()),
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Most recent MCP tool call by this agent, derived from the audit log
  // (actor_type='agent'). Null if it has never made a call. OAuth (sign-in)
  // agents rely on this since they have no API key with a lastUsedAt.
  lastActiveAt: z.string().datetime().nullable(),
});
export type Agent = z.infer<typeof agentSchema>;

export const agentApiKeySchema = z.object({
  id: uuid,
  agentId: uuid,
  prefix: z.string(),
  scopes: z.array(agentKeyScope),
  lastUsedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type AgentApiKey = z.infer<typeof agentApiKeySchema>;

export const createAgentInput = z.object({
  name: z.string().min(1).max(200),
  kind: agentKind.default('mcp_generic'),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type CreateAgentInput = z.infer<typeof createAgentInput>;

export const createAgentKeyInput = z.object({
  // Default to full access so a key minted today keeps working as we ship new
  // capabilities. Callers wanting a narrow key pass an explicit granular list.
  scopes: z.array(agentKeyScope).min(1).default([WILDCARD_SCOPE]),
});
export type CreateAgentKeyInput = z.infer<typeof createAgentKeyInput>;

export const listAgentsQuery = z.object({
  workspaceId: uuid,
  // Archived agents are hidden by default; accepts a bare boolean or the
  // string form it takes as a query param.
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .default(false),
});
export type ListAgentsQuery = z.infer<typeof listAgentsQuery>;
