import type { Agent, AgentKeyScope, AgentKind } from '@palouse/shared';

/**
 * True for agents connected over MCP sign-in (OAuth) rather than an API key.
 * The connect flow stamps the OAuth client id into the agent metadata; those
 * agents have no API key and are managed as connections, not keys.
 */
export function isOAuthAgent(agent: Pick<Agent, 'metadata'>): boolean {
  return typeof agent.metadata?.oauthClientId === 'string';
}

export const AGENT_KIND_LABELS: Record<AgentKind, string> = {
  mcp_generic: 'Generic MCP',
  claude_code: 'Claude Code',
  paperclip: 'Paperclip',
  custom: 'Custom',
};

export const SCOPE_LABELS: Record<AgentKeyScope, string> = {
  'tasks:read': 'Read tasks',
  'tasks:write': 'Write tasks',
  'decisions:read': 'Read decisions',
  'decisions:write': 'Write decisions',
  'objectives:read': 'Read objectives',
  'objectives:write': 'Write objectives',
  'projects:read': 'Read projects',
  'projects:write': 'Write projects',
  'handoffs:claim': 'Claim handoffs',
  'handoffs:complete': 'Complete handoffs',
  'usage:write': 'Report usage',
  '*': 'Full access',
};
