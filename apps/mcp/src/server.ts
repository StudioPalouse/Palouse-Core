import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TOOL_DESCRIPTIONS, TOOL_INPUTS, type ToolName } from '@palouse/mcp-sdk';
import {
  agentService,
  capabilityService,
  decisionService,
  handoffService,
  objectiveService,
  projectService,
  taskService,
  usageService,
} from '@palouse/core';
import type { Database } from '@palouse/db';
import { enqueuePush } from '@palouse/queue';
import {
  agentActor,
  forbidden,
  PalouseError,
  type AgentKeyScope,
  type CapabilityKey,
} from '@palouse/shared';
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
  list_decisions: 'decisions:read',
  get_decision: 'decisions:read',
  create_decision: 'decisions:write',
  update_decision: 'decisions:write',
  add_decision_comment: 'decisions:write',
  set_decision_stakeholders: 'decisions:write',
  add_decision_relation: 'decisions:write',
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
 * Tools gated behind a workspace capability. When a tool appears here, the
 * register wrapper rejects the call if that capability is turned off for the
 * key's workspace. Tools not listed are always available (subject to scope).
 */
const CAPABILITY: Partial<Record<ToolName, CapabilityKey>> = {
  list_decisions: 'decisions',
  get_decision: 'decisions',
  create_decision: 'decisions',
  update_decision: 'decisions',
  add_decision_comment: 'decisions',
  set_decision_stakeholders: 'decisions',
  add_decision_relation: 'decisions',
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

// zod 4 removed z.objectOutputType; infer the parsed shape via ZodObject.
type ToolArgs<N extends ToolName> = z.infer<z.ZodObject<(typeof TOOL_INPUTS)[N]>>;

/** Shown to the agent by MCP clients that surface server instructions. */
const INSTRUCTIONS =
  "Palouse tracks the work agents do for people: what was asked, what the agent did, what it cost, and the result. Workflow: when the person refers to their tasks, their work, or what to do next, call list_tasks to see what is queued for you in Palouse before asking them to restate it, and call get_task to read a task's full description and comments before acting on it; treat Palouse as the source of truth for what you have been asked to do and do not make the person repeat work already tracked there. When a person queues work for you in Palouse, call claim_task to pick it up. When a person hands you work directly in chat, register it with create_task, which creates the task and returns a claimed handoff plus a claimToken in one call. When a person points you at a task that already exists in Palouse, call start_task with its taskId to begin working it. Either way, while you work: call log_step for each meaningful unit of work in plain English, call heartbeat at least every 60 seconds, and report token usage with report_usage after each LLM call. When you finish, call complete_task with a result summary, and if the work fully resolves the task, set its status to done with update_task. If you cannot finish, call fail_task with the reason. Never invent a claimToken; only use one returned by claim_task, create_task, or start_task.";

/**
 * One McpServer per verified agent key. The server is a thin shell: every
 * tool checks the key's scope, delegates to @palouse/core in-process, and
 * appends an audit_events row (actor_type='agent').
 *
 * Only the tools this key may actually call are registered, so the tool list a
 * client discovers reflects the key's scopes and the workspace's enabled
 * capabilities. A full-access ('*') key therefore picks up new tools
 * automatically as capabilities ship, with no re-mint. Capabilities are read
 * once per connection and reused for the per-call defensive re-check.
 */
export async function buildServer(db: Database, key: VerifiedAgentKey): Promise<McpServer> {
  const server = new McpServer(
    { name: 'palouse', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );

  const caps = await capabilityService.capabilitiesForWorkspace(db, key.workspaceId);

  /** A tool is available when the key holds its scope and its capability is on. */
  function isAvailable(name: ToolName): boolean {
    if (!agentService.hasScope(key, SCOPES[name])) return false;
    const capability = CAPABILITY[name];
    return !capability || caps[capability] !== false;
  }

  function register<N extends ToolName>(name: N, handler: (args: ToolArgs<N>) => Promise<unknown>) {
    // Don't advertise (or wire up) tools this key can't use.
    if (!isAvailable(name)) return;

    const callback = async (args: ToolArgs<N>): Promise<CallToolResult> => {
      try {
        agentService.requireScope(key, SCOPES[name]);
        const capability = CAPABILITY[name];
        if (capability && caps[capability] === false) {
          throw forbidden(`The ${capability} capability is turned off for this workspace.`);
        }
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
    const task = await taskService.updateTask(
      db,
      key.workspaceId,
      agentActor(key.agentId),
      taskId,
      input,
    );
    // Mirror the change back to any linked external systems (worker no-ops
    // when the task has no sources).
    await enqueuePush(getSyncQueue(), task.id, key.workspaceId).catch(() => {});
    return { task };
  });

  register('add_comment', async (args) => ({
    comment: await taskService.addComment(
      db,
      key.workspaceId,
      agentActor(key.agentId),
      args.taskId,
      {
        bodyMd: args.bodyMd,
      },
    ),
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

  register('list_decisions', async (args) =>
    decisionService.listDecisions(db, {
      workspaceId: key.workspaceId,
      status: args.status,
      area: args.area,
      search: args.search,
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
    }),
  );

  register('get_decision', async (args) =>
    decisionService.getDecision(db, key.workspaceId, args.decisionId),
  );

  register('create_decision', async (args) => ({
    decision: await decisionService.createDecision(db, key.workspaceId, agentActor(key.agentId), {
      title: args.title,
      descriptionMd: args.descriptionMd,
      area: args.area,
      status: args.status,
      stakeholders: args.stakeholders,
      relations: args.relations,
    }),
  }));

  register('update_decision', async (args) => {
    const { decisionId, ...input } = args;
    return {
      decision: await decisionService.updateDecision(
        db,
        key.workspaceId,
        agentActor(key.agentId),
        decisionId,
        input,
      ),
    };
  });

  register('add_decision_comment', async (args) => ({
    comment: await decisionService.addComment(
      db,
      key.workspaceId,
      agentActor(key.agentId),
      args.decisionId,
      { bodyMd: args.bodyMd },
    ),
  }));

  register('set_decision_stakeholders', async (args) => ({
    stakeholders: await decisionService.setStakeholders(
      db,
      key.workspaceId,
      agentActor(key.agentId),
      args.decisionId,
      { stakeholders: args.stakeholders },
    ),
  }));

  register('add_decision_relation', async (args) => ({
    relation: await decisionService.addRelation(
      db,
      key.workspaceId,
      agentActor(key.agentId),
      args.decisionId,
      { entityType: args.entityType, entityId: args.entityId },
    ),
  }));

  register('list_objectives', async (args) =>
    objectiveService.listObjectives(db, {
      workspaceId: key.workspaceId,
      status: args.status,
      area: args.area,
      search: args.search,
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
    }),
  );

  register('get_objective', async (args) =>
    objectiveService.getObjective(db, key.workspaceId, args.objectiveId, {
      // Only surface related decisions when the decisions capability is on, so a
      // disabled capability never leaks decision titles through objectives:read.
      includeRelatedDecisions: caps.decisions !== false,
    }),
  );

  register('create_objective', async (args) => ({
    objective: await objectiveService.createObjective(
      db,
      key.workspaceId,
      agentActor(key.agentId),
      {
        title: args.title,
        descriptionMd: args.descriptionMd,
        area: args.area,
        status: args.status,
        targetDate: args.targetDate,
        keyResults: args.keyResults,
      },
    ),
  }));

  register('update_objective', async (args) => {
    const { objectiveId, ...input } = args;
    return {
      objective: await objectiveService.updateObjective(
        db,
        key.workspaceId,
        agentActor(key.agentId),
        objectiveId,
        input,
      ),
    };
  });

  register('list_projects', async (args) =>
    projectService.listProjects(db, {
      workspaceId: key.workspaceId,
      status: args.status,
      search: args.search,
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
    }),
  );

  register('get_project', async (args) =>
    projectService.getProject(db, key.workspaceId, args.projectId, {
      // Only surface related decisions when the decisions capability is on, so a
      // disabled capability never leaks decision titles through projects:read.
      includeRelatedDecisions: caps.decisions !== false,
    }),
  );

  register('create_project', async (args) => ({
    project: await projectService.createProject(db, key.workspaceId, agentActor(key.agentId), {
      name: args.name,
      descriptionMd: args.descriptionMd,
      status: args.status,
    }),
  }));

  register('update_project', async (args) => {
    const { projectId, ...input } = args;
    return {
      project: await projectService.updateProject(
        db,
        key.workspaceId,
        agentActor(key.agentId),
        projectId,
        input,
      ),
    };
  });

  register('create_project_item', async (args) => ({
    item: await projectService.createProjectItem(
      db,
      key.workspaceId,
      agentActor(key.agentId),
      args.projectId,
      {
        columnId: args.columnId,
        title: args.title,
        descriptionMd: args.descriptionMd,
        startDate: args.startDate,
        endDate: args.endDate,
        completed: args.completed,
      },
    ),
  }));

  register('update_project_item', async (args) => {
    const { projectId, itemId, ...input } = args;
    return {
      item: await projectService.updateProjectItem(
        db,
        key.workspaceId,
        agentActor(key.agentId),
        projectId,
        itemId,
        input,
      ),
    };
  });

  registerResources(server, db, key);

  return server;
}
