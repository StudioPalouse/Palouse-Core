import { z } from 'zod';
import { uuid } from './ids.js';

export const agentKind = z.enum(['mcp_generic', 'paperclip', 'claude_code', 'custom']);
export type AgentKind = z.infer<typeof agentKind>;

export const agentKeyScope = z.enum([
  'tasks:read',
  'tasks:write',
  'handoffs:claim',
  'handoffs:complete',
  'usage:write',
]);
export type AgentKeyScope = z.infer<typeof agentKeyScope>;

export const ALL_AGENT_KEY_SCOPES = agentKeyScope.options;

export const agentSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  name: z.string(),
  kind: agentKind,
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
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
  metadata: z.record(z.unknown()).default({}),
});
export type CreateAgentInput = z.infer<typeof createAgentInput>;

export const createAgentKeyInput = z.object({
  scopes: z.array(agentKeyScope).min(1).default([...ALL_AGENT_KEY_SCOPES]),
});
export type CreateAgentKeyInput = z.infer<typeof createAgentKeyInput>;

export const listAgentsQuery = z.object({
  workspaceId: uuid,
});
export type ListAgentsQuery = z.infer<typeof listAgentsQuery>;
