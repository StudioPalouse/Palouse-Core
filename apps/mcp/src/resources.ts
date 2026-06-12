import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RESOURCES } from '@reqops/mcp-sdk';
import { handoffService, taskService } from '@reqops/core';
import type { Database } from '@reqops/db';
import { forbidden } from '@reqops/shared';
import type { VerifiedAgentKey } from './auth.js';

/**
 * The three read-only `reqops://` resources from architecture.md §6. Agent
 * keys are workspace-bound, so any {wsId} other than the key's own is refused.
 */
export function registerResources(server: McpServer, db: Database, key: VerifiedAgentKey): void {
  const assertWorkspace = (wsId: string | string[] | undefined) => {
    if (wsId !== key.workspaceId) {
      throw forbidden('This agent key belongs to a different workspace');
    }
  };

  const json = (uri: URL, payload: unknown) => ({
    contents: [
      { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) },
    ],
  });

  server.registerResource(
    'workspace-tasks',
    new ResourceTemplate(RESOURCES.tasks, {
      list: async () => ({
        resources: [
          {
            uri: RESOURCES.tasks.replace('{wsId}', key.workspaceId),
            name: 'Workspace tasks',
            mimeType: 'application/json',
          },
          {
            uri: RESOURCES.queuedHandoffs.replace('{wsId}', key.workspaceId),
            name: 'Queued handoffs for this agent',
            mimeType: 'application/json',
          },
        ],
      }),
    }),
    { description: 'All tasks in the workspace, newest first (first 100).' },
    async (uri, vars) => {
      assertWorkspace(vars.wsId);
      return json(uri, await taskService.listTasks(db, { workspaceId: key.workspaceId, limit: 100, offset: 0 }));
    },
  );

  server.registerResource(
    'workspace-task',
    new ResourceTemplate(RESOURCES.task, { list: undefined }),
    { description: 'A single task with comments and sources.' },
    async (uri, vars) => {
      assertWorkspace(vars.wsId);
      return json(uri, await taskService.getTask(db, key.workspaceId, String(vars.taskId)));
    },
  );

  server.registerResource(
    'queued-handoffs',
    new ResourceTemplate(RESOURCES.queuedHandoffs, { list: undefined }),
    { description: 'Handoffs queued for this agent — claim one with claim_task.' },
    async (uri, vars) => {
      assertWorkspace(vars.wsId);
      return json(
        uri,
        await handoffService.listHandoffs(db, {
          workspaceId: key.workspaceId,
          agentId: key.agentId,
          state: 'queued',
          limit: 100,
          offset: 0,
        }),
      );
    },
  );
}
