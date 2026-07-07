import type { AgentKeyScope, AgentKind } from '@palouse/shared';

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
