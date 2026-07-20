import { describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS, type AgentKeyScope, type WorkspaceCapabilities } from '@palouse/shared';
import { CAPABILITY, SCOPES, isToolAvailable } from './tool-access.js';

const ALL_ON = Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, true])) as WorkspaceCapabilities;
const FULL: AgentKeyScope[] = ['*'];

const TASK_TOOLS = [
  'list_tasks',
  'get_task',
  'create_task',
  'start_task',
  'claim_task',
  'update_task',
  'add_comment',
  'heartbeat',
  'log_step',
  'report_usage',
  'request_review',
  'complete_task',
  'fail_task',
] as const;

describe('MCP tool gating by workspace capability', () => {
  it('gates the whole task + handoff workflow on the tasks capability', () => {
    for (const tool of TASK_TOOLS) {
      expect(CAPABILITY[tool], `${tool} should be gated on tasks`).toBe('tasks');
    }
  });

  it('hides task tools when Tasks is disabled but leaves other areas available', () => {
    const caps = { ...ALL_ON, tasks: false };
    expect(isToolAvailable('list_tasks', FULL, caps)).toBe(false);
    expect(isToolAvailable('create_task', FULL, caps)).toBe(false);
    expect(isToolAvailable('complete_task', FULL, caps)).toBe(false);
    // A different area is unaffected.
    expect(isToolAvailable('list_decisions', FULL, caps)).toBe(true);
    expect(isToolAvailable('list_projects', FULL, caps)).toBe(true);
  });

  it('offers task tools when Tasks is enabled', () => {
    expect(isToolAvailable('list_tasks', FULL, ALL_ON)).toBe(true);
    expect(isToolAvailable('create_task', FULL, ALL_ON)).toBe(true);
  });

  it('still requires the scope regardless of capability', () => {
    const narrow: AgentKeyScope[] = ['decisions:read'];
    expect(isToolAvailable('list_tasks', narrow, ALL_ON)).toBe(false); // missing tasks:read
    expect(isToolAvailable('list_decisions', narrow, ALL_ON)).toBe(true);
    expect(isToolAvailable('create_decision', narrow, ALL_ON)).toBe(false); // needs decisions:write
  });

  it('treats a missing capability override as enabled (only explicit false gates)', () => {
    // An empty map means no overrides: everything the scope allows is available.
    const noOverrides = {} as WorkspaceCapabilities;
    expect(isToolAvailable('list_tasks', FULL, noOverrides)).toBe(true);
    expect(isToolAvailable('list_decisions', FULL, noOverrides)).toBe(true);
  });

  it('maps every tool to a scope', () => {
    for (const tool of Object.keys(CAPABILITY) as (keyof typeof CAPABILITY)[]) {
      expect(SCOPES[tool], `${tool} must have a scope`).toBeDefined();
    }
  });
});
