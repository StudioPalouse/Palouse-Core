import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TOOL_DESCRIPTIONS, TOOL_INPUTS, type ToolName } from '@reqops/mcp-sdk';
import { agentService, handoffService, taskService, usageService } from '@reqops/core';
import type { Database } from '@reqops/db';
import { enqueuePush } from '@reqops/queue';
import { agentActor, ReqOpsError, type AgentKeyScope } from '@reqops/shared';
import { auditToolCall, type VerifiedAgentKey } from './auth.js';
import { getSyncQueue } from './queue.js';
import { registerResources } from './resources.js';

const SCOPES: Record<ToolName, AgentKeyScope> = {
  list_tasks: 'tasks:read',
  get_task: 'tasks:read',
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

/**
 * One McpServer per verified agent key. The server is a thin shell: every
 * tool checks the key's scope, delegates to @reqops/core in-process, and
 * appends an audit_events row (actor_type='agent').
 */
export function buildServer(db: Database, key: VerifiedAgentKey): McpServer {
  const server = new McpServer({ name: 'reqops', version: '0.1.0' });

  function register<N extends ToolName>(name: N, handler: (args: ToolArgs<N>) => Promise<unknown>) {
    const callback = async (args: ToolArgs<N>): Promise<CallToolResult> => {
      try {
        agentService.requireScope(key, SCOPES[name]);
        const result = await handler(args);
        await auditToolCall(db, key, name, args as Record<string, unknown>);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        if (err instanceof ReqOpsError) {
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

  register('claim_task', async (args) => {
    const claimed = await handoffService.claimNext(db, key.agentId, key.workspaceId, args.taskId);
    if (!claimed) {
      return {
        claimed: false,
        message: args.taskId
          ? 'No queued handoff for that task is assigned to you.'
          : 'No queued handoffs are assigned to you right now.',
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
