/**
 * Who performed a mutation — a signed-in user (session auth) or an agent
 * (MCP / agent API key auth). Services use this to audit correctly and to
 * decide user-only side effects (e.g. comment authorship).
 */
export interface Actor {
  type: 'user' | 'agent';
  id: string;
}

export const userActor = (userId: string): Actor => ({ type: 'user', id: userId });
export const agentActor = (agentId: string): Actor => ({ type: 'agent', id: agentId });
