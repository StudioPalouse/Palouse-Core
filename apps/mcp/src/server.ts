import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TOOL_DESCRIPTIONS, TOOL_INPUTS, type ToolName } from '@palouse/mcp-sdk';
import { agentService, handoffService, taskService, usageService } from '@palouse/core';
import type { Database } from '@palouse/db';
import { enqueuePush } from '@palouse/queue';
import { agentActor, PalouseError, type AgentKeyScope } from '@palouse/shared';
import { auditToolCall, type VerifiedAgentKey } from './auth.js';
import { getSyncQueue } from './queue.js';
import { registerResources } from './resources.js';

const SCOPES: Record<ToolName, AgentKeyScope> = {
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
};

type ToolArgs<N extends ToolName> = z.objectOutputType<(typeof TOOL_INPUTS)[N], z.ZodTypeAny>;

/** Shown to the agent by MCP clients that surface server instructions. */
const INSTRUCTIONS =
  'Palouse tracks the work agents do for people: what was asked, what the agent did, what it cost, and the result. Workflow: when a person queues work for you in Palouse, call claim_task to pick it up. When a person hands you work directly in chat, register it with create_task, which creates the task and returns a claimed handoff plus a claimToken in one call. When a person points you at a task that already exists in Palouse, call start_task with its taskId to begin working it. Either way, while you work: call log_step for each meaningful unit of work in plain English, call heartbeat at least every 60 seconds, and report token usage with report_usage after each LLM call. When you finish, call complete_task with a result summary, and if the work fully resolves the task, set its status to done with update_task. If you cannot finish, call fail_task with the reason. Never invent a claimToken; only use one returned by claim_task, create_task, or start_task.';

/**
 * One McpServer per verified agent key. The server is a thin shell: every
 * tool checks the key's scope, delegates to @palouse/core in-process, and
 * appends an audit_events row (actor_type='agent').
 */
export function buildServer(db: Database, key: VerifiedAgentKey): McpServer {
  const server = new McpServer({ name: 'palouse', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  function register<N extends ToolName>(name: N, handler: (args: ToolArgs<N>) => Promise<unknown>) {
    const callback = async (args: ToolArgs<N>): Promise<CallToolResult> => {
      try {
        agentService.requireScope(key, SCOPES[name]);
        const result = await handler(args);
        await auditToolCall(db, key, name, args as Record<string, unknown>);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        if (err instanceof PalouseError) {
          return {
            content: [{ type: 'text', text: `${err.code}: ${err.message}` }],
            isError: true,
          };
        }
        throw err;
      }
    };
    server.registerTool(
      name,
      { description: TOOL_DESCRIPTIONS[name], inputSchema: TOOL_INPUTS[name] },
      // The per-tool shape union defeats the SDK's generic callback inference;
      // `callback` is already typed against TOOL_INPUTS[name] above.
      callback as never,
    );
  }

  register('list_tasks', async (args) =>
    taskService.listTasks(db, {
      workspaceId: key.workspaceId,
      status: args.status,
      search: args.search,
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
    }),
  );

  register('get_task', async (args) => {
    const detail = await taskService.getTask(db, key.workspaceId, args.taskId);
    const { handoffs } = await handoffService.listHandoffs(db, {
      workspaceId: key.workspaceId,
      taskId: args.taskId,
      limit: 50,
      offset: 0,
    });
    return { ...detail, handoffs };
  });

  register('create_task', async (args) => {
    // The response includes a live claim, so require the claim scope up front
    // rather than letting the agent discover it is stuck on the first heartbeat.
    agentService.requireScope(key, 'handoffs:claim');
    const { task, handoff, claimToken } = await handoffService.createAgentTask(
      db,
      key.workspaceId,
      key.agentId,
      args,
    );
    return { task, claimed: true, handoff, claimToken };
  });

  register('start_task', async (args) => {
    const { handoff, claimToken } = await handoffService.openClaimedHandoff(
      db,
      key.workspaceId,
      key.agentId,
      args.taskId,
      { reviewRequired: args.reviewRequired ?? false },
    );
    return { claimed: true, handoff, claimToken };
  });

  register('claim_task', async (args) => {
    const claimed = await handoffService.claimNext(db, key.agentId, key.workspaceId, args.taskId);
    if (!claimed) {
      return {
        claimed: false,
        message: args.taskId
          ? 'No queued handoff for that task is assigned to you. If a person gave you this work directly, register it with create_task instead: it opens a claimed handoff for you in one call.'
          : 'No queued handoffs are assigned to you right now. If a person gave you work directly in this conversation, register it with create_task: it creates the task and opens a claimed handoff for you in one call.',
      };
    }
    return { claimed: true, ...claimed };
  });

  register('update_task', async (args) => {
    const { taskId, ...input } = args;
    const task = await taskService.updateTask(db, key.workspaceId, agentActor(key.agentId), taskId, input);
    // Mirror the change back to any linked external systems (worker no-ops
    // when the task has no sources).
    await enqueuePush(getSyncQueue(), task.id, key.workspaceId).catch(() => {});
    return { task };
  });

  register('add_comment', async (args) => ({
    comment: await taskService.addComment(db, key.workspaceId, agentActor(key.agentId), args.taskId, {
      bodyMd: args.bodyMd,
    }),
  }));

  register('heartbeat', async (args) => ({
    handoff: await handoffService.heartbeat(db, args.claimToken, args.usage),
  }));

  register('log_step', async (args) =>
    usageService.recordStep(db, args.claimToken, {
      title: args.title,
      detailMd: args.detail,
      status: args.status,
      usage: args.usage,
    }),
  );

  register('report_usage', async (args) =>
    usageService.reportUsage(db, args.claimToken, args.usage, args.stepTitle),
  );

  register('request_review', async (args) => ({
    handoff: await handoffService.requestReview(db, args.claimToken, args.summary),
  }));

  register('complete_task', async (args) => ({
    handoff: await handoffService.complete(db, args.claimToken, args.resultSummaryMd, args.usage),
  }));

  register('fail_task', async (args) => ({
    handoff: await handoffService.fail(db, args.claimToken, args.reason, args.usage),
  }));

  registerResources(server, db, key);

  return server;
}
