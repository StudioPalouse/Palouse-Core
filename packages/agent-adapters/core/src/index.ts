import type { Handoff, Task } from '@reqops/shared';

export interface AgentDispatchInput {
  task: Task;
  handoff: Handoff;
  workspaceId: string;
}

/**
 * Outbound bridge to an external agent platform.
 * Implementations notify the agent that a handoff exists; the agent then
 * calls back via the MCP tool surface to claim / progress / complete.
 */
export interface AgentAdapter {
  readonly kind: string;
  dispatch(input: AgentDispatchInput): Promise<void>;
}
