import type { ToolName } from '@palouse/mcp-sdk';
import {
  WILDCARD_SCOPE,
  type AgentKeyScope,
  type CapabilityKey,
  type WorkspaceCapabilities,
} from '@palouse/shared';

/** The scope each tool requires. A key must hold it (or the wildcard) to call. */
export const SCOPES: Record<ToolName, AgentKeyScope> = {
  list_tasks: 'tasks:read',
  get_task: 'tasks:read',
  create_task: 'tasks:write',
  start_task: 'handoffs:claim',
  claim_task: 'handoffs:claim',
  update_task: 'tasks:write',
  add_comment: 'tasks:write',
  heartbeat: 'handoffs:claim',
  log_step: 'usage:write',
  report_usage: 'usage:write',
  request_review: 'handoffs:complete',
  complete_task: 'handoffs:complete',
  fail_task: 'handoffs:complete',
  list_decisions: 'decisions:read',
  get_decision: 'decisions:read',
  create_decision: 'decisions:write',
  update_decision: 'decisions:write',
  add_decision_comment: 'decisions:write',
  set_decision_stakeholders: 'decisions:write',
  add_decision_relation: 'decisions:write',
  get_strategy_signals: 'decisions:read',
  list_objectives: 'objectives:read',
  get_objective: 'objectives:read',
  create_objective: 'objectives:write',
  update_objective: 'objectives:write',
  list_projects: 'projects:read',
  get_project: 'projects:read',
  create_project: 'projects:write',
  update_project: 'projects:write',
  create_project_item: 'projects:write',
  update_project_item: 'projects:write',
};

/**
 * Tools gated behind a workspace capability. When a tool appears here, it is
 * only available if that capability is on for the key's workspace; the register
 * wrapper drops it from `tools/list` and the handler refuses it defensively.
 * Tools not listed are always available (subject to scope).
 */
export const CAPABILITY: Partial<Record<ToolName, CapabilityKey>> = {
  // The task + handoff + usage workflow is the Tasks area (the web gates both
  // /tasks and /reviews on 'tasks'). With Tasks off, none of it is offered.
  list_tasks: 'tasks',
  get_task: 'tasks',
  create_task: 'tasks',
  start_task: 'tasks',
  claim_task: 'tasks',
  update_task: 'tasks',
  add_comment: 'tasks',
  heartbeat: 'tasks',
  log_step: 'tasks',
  report_usage: 'tasks',
  request_review: 'tasks',
  complete_task: 'tasks',
  fail_task: 'tasks',
  list_decisions: 'decisions',
  get_decision: 'decisions',
  create_decision: 'decisions',
  update_decision: 'decisions',
  add_decision_comment: 'decisions',
  set_decision_stakeholders: 'decisions',
  add_decision_relation: 'decisions',
  get_strategy_signals: 'decisions',
  list_objectives: 'objectives',
  get_objective: 'objectives',
  create_objective: 'objectives',
  update_objective: 'objectives',
  list_projects: 'projects',
  get_project: 'projects',
  create_project: 'projects',
  update_project: 'projects',
  create_project_item: 'projects',
  update_project_item: 'projects',
};

/**
 * A tool is available when the key holds its scope (or the wildcard) and its
 * capability is on for the workspace. A capability with no override row reads as
 * enabled, so only an explicit `false` gates a tool off.
 */
export function isToolAvailable(
  name: ToolName,
  scopes: AgentKeyScope[],
  caps: WorkspaceCapabilities,
): boolean {
  const holdsScope = scopes.includes(WILDCARD_SCOPE) || scopes.includes(SCOPES[name]);
  if (!holdsScope) return false;
  const capability = CAPABILITY[name];
  return !capability || caps[capability] !== false;
}
