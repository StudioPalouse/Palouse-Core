// Tool/resource definitions shared between apps/mcp and any future SDKs.
// One entry per tool from docs/architecture.md §6: Zod input shape + the
// description agents see. Keeping these here guarantees server and client
// SDKs never drift.
import { z } from 'zod';
import {
  decisionEntityType,
  decisionStatus,
  handoffState,
  objectiveStatus,
  projectStatus,
  raciRole,
  taskStatus,
} from '@palouse/shared';

export const TOOLS = [
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
  'list_decisions',
  'get_decision',
  'create_decision',
  'update_decision',
  'add_decision_comment',
  'set_decision_stakeholders',
  'add_decision_relation',
  'list_objectives',
  'get_objective',
  'create_objective',
  'update_objective',
  'list_projects',
  'get_project',
  'create_project',
  'update_project',
  'create_project_item',
  'update_project_item',
] as const;

export type ToolName = (typeof TOOLS)[number];

const taskId = z.string().uuid().describe('Palouse task id (uuid)');
const decisionId = z.string().uuid().describe('Palouse decision id (uuid)');
const objectiveId = z.string().uuid().describe('Palouse objective id (uuid)');
const projectId = z.string().uuid().describe('Palouse project id (uuid)');
const projectItemId = z.string().uuid().describe('Palouse project item (card) id (uuid)');
const keyResultInput = z.object({
  name: z.string().min(1).max(300).describe('What is being measured, e.g. "Signups per week"'),
  startValue: z.number().default(0).describe('Baseline value at the start (defaults to 0)'),
  targetValue: z.number().describe('The value that counts as done'),
  currentValue: z.number().optional().describe('Latest value (defaults to the start value)'),
  unit: z.string().max(50).optional().describe('Unit label, e.g. "%", "$", or "users"'),
});
const stakeholderAssignment = z.object({
  userId: z.string().uuid().describe('Palouse user id of the stakeholder'),
  role: raciRole.describe('RACI role: responsible, accountable, consulted, or informed'),
});
const relationRef = z.object({
  entityType: decisionEntityType.describe(
    "Related entity kind. 'task', 'goal' (objective), and 'key_result' resolve to a title/status on read; 'project', 'project_item', and 'context' are reserved.",
  ),
  entityId: z.string().uuid(),
});
const claimToken = z
  .string()
  .uuid()
  .describe('Claim token returned by claim_task; required on every call about a claimed handoff');

/**
 * Usage increment since your previous report — copy the usage block from the
 * provider's API response. Each report becomes exactly one ledger row; never
 * re-send cumulative totals.
 */
const usageInput = z.object({
  model: z
    .string()
    .min(1)
    .max(200)
    .describe("Model id as the provider reports it, e.g. 'claude-opus-4-8'"),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  costUsd: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      'Your own cost estimate, if you have one. Stored separately; Palouse computes the official cost from its price catalog.',
    ),
});

const optionalUsage = usageInput
  .optional()
  .describe('Optional usage increment since your previous report (one ledger entry per report)');

/** Zod raw shapes, consumable directly by McpServer.registerTool. */
export const TOOL_INPUTS = {
  list_tasks: {
    status: taskStatus.optional().describe('Filter by task status'),
    search: z.string().max(200).optional().describe('Substring match on the task title'),
    limit: z.number().int().min(1).max(100).default(50).optional(),
    offset: z.number().int().min(0).default(0).optional(),
  },
  get_task: { taskId },
  create_task: {
    title: z
      .string()
      .min(1)
      .max(500)
      .describe('Short task title a human will read in their task list'),
    descriptionMd: z
      .string()
      .max(20_000)
      .optional()
      .describe('What you were asked to do and any context (markdown)'),
    priority: z
      .number()
      .int()
      .min(0)
      .max(4)
      .optional()
      .describe('0 = urgent, 4 = none. Defaults to 2.'),
    dueAt: z.string().datetime().optional(),
    reviewRequired: z
      .boolean()
      .optional()
      .describe(
        'Set true if the person wants to review and approve the result before the work counts as complete. Defaults to false.',
      ),
  },
  start_task: {
    taskId,
    reviewRequired: z
      .boolean()
      .optional()
      .describe(
        'Set true if the person wants to review and approve the result before the work counts as complete. Defaults to false.',
      ),
  },
  claim_task: {
    taskId: taskId
      .optional()
      .describe('Claim the handoff for this specific task; omit to claim the next queued handoff'),
  },
  update_task: {
    taskId,
    title: z.string().min(1).max(500).optional(),
    descriptionMd: z.string().max(20_000).nullable().optional(),
    status: taskStatus.optional(),
    priority: z.number().int().min(0).max(4).optional().describe('0 = urgent … 4 = none'),
    dueAt: z.string().datetime().nullable().optional(),
  },
  add_comment: {
    taskId,
    bodyMd: z.string().min(1).max(20_000).describe('Comment body (markdown)'),
  },
  heartbeat: { claimToken, usage: optionalUsage },
  log_step: {
    claimToken,
    title: z
      .string()
      .min(1)
      .max(300)
      .describe(
        "Plain-English step title a business user will read, e.g. 'Drafted the Q2 summary'",
      ),
    detail: z.string().max(20_000).optional().describe('Optional detail (markdown)'),
    status: z
      .enum(['started', 'completed', 'failed'])
      .optional()
      .describe("Defaults to 'completed'"),
    usage: optionalUsage,
  },
  report_usage: {
    claimToken,
    usage: usageInput.describe('Usage from one LLM call (required)'),
    stepTitle: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe('Optionally create a narrative step this usage belongs to'),
  },
  request_review: {
    claimToken,
    summary: z
      .string()
      .min(1)
      .max(20_000)
      .describe('What you did and what the reviewer should check (markdown)'),
  },
  complete_task: {
    claimToken,
    resultSummaryMd: z
      .string()
      .min(1)
      .max(20_000)
      .describe('Plain-English summary of the result (markdown)'),
    usage: optionalUsage,
  },
  fail_task: {
    claimToken,
    reason: z.string().min(1).max(4000).describe('Why the task could not be finished'),
    usage: optionalUsage,
  },
  list_decisions: {
    status: decisionStatus.optional().describe('Filter by decision stage'),
    area: z.string().max(200).optional().describe('Filter by the free-text area/grouping'),
    search: z.string().max(200).optional().describe('Substring match on the decision title'),
    limit: z.number().int().min(1).max(200).default(50).optional(),
    offset: z.number().int().min(0).default(0).optional(),
  },
  get_decision: { decisionId },
  create_decision: {
    title: z.string().min(1).max(500).describe('Short statement of what is being decided'),
    descriptionMd: z
      .string()
      .max(50_000)
      .optional()
      .describe('Background, the options weighed, and the reasoning (markdown)'),
    area: z
      .string()
      .max(200)
      .optional()
      .describe('Optional grouping, e.g. "Billing" or a project name'),
    status: decisionStatus.optional().describe("Defaults to 'proposed'"),
    stakeholders: z
      .array(stakeholderAssignment)
      .max(100)
      .optional()
      .describe('Initial RACI roster. At most one accountable.'),
    relations: z
      .array(relationRef)
      .max(100)
      .optional()
      .describe('Entities this decision relates to (only task links resolve today)'),
  },
  update_decision: {
    decisionId,
    title: z.string().min(1).max(500).optional(),
    descriptionMd: z.string().max(50_000).nullable().optional(),
    area: z.string().max(200).nullable().optional(),
    status: decisionStatus
      .optional()
      .describe('Advance the stage. Accepting requires exactly one accountable stakeholder.'),
  },
  add_decision_comment: {
    decisionId,
    bodyMd: z.string().min(1).max(50_000).describe('Comment body (markdown)'),
  },
  set_decision_stakeholders: {
    decisionId,
    stakeholders: z
      .array(stakeholderAssignment)
      .max(100)
      .describe('Full replacement RACI roster. At most one accountable.'),
  },
  add_decision_relation: {
    decisionId,
    entityType: decisionEntityType,
    entityId: z.string().uuid(),
  },
  list_objectives: {
    status: objectiveStatus.optional().describe('Filter by objective status'),
    area: z.string().max(200).optional().describe('Filter by the free-text area/grouping'),
    search: z.string().max(200).optional().describe('Substring match on the objective title'),
    limit: z.number().int().min(1).max(200).default(50).optional(),
    offset: z.number().int().min(0).default(0).optional(),
  },
  get_objective: { objectiveId },
  create_objective: {
    title: z.string().min(1).max(500).describe('Short statement of the goal'),
    descriptionMd: z
      .string()
      .max(50_000)
      .optional()
      .describe('Why this goal matters and how it will be judged (markdown)'),
    area: z
      .string()
      .max(200)
      .optional()
      .describe('Optional grouping, e.g. "Growth" or a team name'),
    status: objectiveStatus.optional().describe("Defaults to 'planning'"),
    targetDate: z.string().datetime().optional().describe('When the goal should be reached'),
    keyResults: z
      .array(keyResultInput)
      .max(100)
      .optional()
      .describe('Measurable key results this objective is scored on'),
  },
  update_objective: {
    objectiveId,
    title: z.string().min(1).max(500).optional(),
    descriptionMd: z.string().max(50_000).nullable().optional(),
    area: z.string().max(200).nullable().optional(),
    status: objectiveStatus
      .optional()
      .describe('planning, active, at_risk, achieved, missed, or archived'),
    targetDate: z.string().datetime().nullable().optional(),
  },
  list_projects: {
    status: projectStatus.optional().describe('Filter by project status'),
    search: z.string().max(200).optional().describe('Substring match on the project name'),
    limit: z.number().int().min(1).max(200).default(50).optional(),
    offset: z.number().int().min(0).default(0).optional(),
  },
  get_project: { projectId },
  create_project: {
    name: z.string().min(1).max(300).describe('Short project name'),
    descriptionMd: z
      .string()
      .max(50_000)
      .optional()
      .describe('What the project is about and its goal (markdown)'),
    status: projectStatus.optional().describe("Defaults to 'active'"),
  },
  update_project: {
    projectId,
    name: z.string().min(1).max(300).optional(),
    descriptionMd: z.string().max(50_000).nullable().optional(),
    status: projectStatus.optional().describe('planning, active, on_hold, completed, or archived'),
  },
  create_project_item: {
    projectId,
    columnId: z
      .string()
      .uuid()
      .optional()
      .describe('Column (list) to add the card to; defaults to the first column'),
    title: z.string().min(1).max(500).describe('Short card title'),
    descriptionMd: z.string().max(50_000).optional().describe('Card detail (markdown)'),
    startDate: z.string().datetime().optional().describe('Timeline start for the Gantt view'),
    endDate: z.string().datetime().optional().describe('Timeline due date for the Gantt view'),
    completed: z.boolean().optional().describe('Mark the card done on creation'),
  },
  update_project_item: {
    projectId,
    itemId: projectItemId,
    columnId: z
      .string()
      .uuid()
      .optional()
      .describe('Move the card to this column; a done column marks it complete'),
    title: z.string().min(1).max(500).optional(),
    descriptionMd: z.string().max(50_000).nullable().optional(),
    startDate: z.string().datetime().nullable().optional(),
    endDate: z.string().datetime().nullable().optional(),
    completed: z.boolean().optional().describe('Mark the card done or not done'),
  },
} satisfies Record<ToolName, z.ZodRawShape>;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  list_tasks:
    'List tasks in your workspace, filterable by status and title search. Call this whenever the person refers to their tasks, their work, or what to do next, to see what is already queued for them before asking them to restate it.',
  get_task:
    "Fetch one task with its comments and full agent handoff history. Read a task's full description and comments with this before you start acting on it, so you don't ask the person for context Palouse already has.",
  create_task:
    'Register work you are starting in Palouse. Use this when a person hands you work directly in chat instead of queueing it in Palouse first. Creates the task in the workspace, marks it as agent-originated, and atomically opens a handoff already claimed by you. Returns the task, the handoff, and a claimToken: treat it exactly like a claim_task result, so log_step as you work, heartbeat at least every 60 seconds, and complete_task or fail_task when done. Set reviewRequired to true when the person wants to approve the result. Do not use this for tasks that already exist in Palouse; use claim_task for queued work or start_task to begin an existing task.',
  start_task:
    'Start working on a task that already exists in Palouse when a person points you at it directly in chat instead of queueing a handoff. Atomically opens a handoff already claimed by you and returns it with a claimToken: treat it exactly like a claim_task result. Fails if the task already has an active handoff; call claim_task first in case the work was queued for you.',
  claim_task:
    'Atomically claim a queued handoff assigned to you. Returns the handoff, its deadline, and a claimToken you must present on heartbeat, request_review, complete_task, and fail_task. Exactly one claimer ever wins.',
  update_task: 'Update task fields (title, description, status, priority, due date).',
  add_comment: 'Append a comment to a task. Use it to leave progress notes humans will read.',
  heartbeat:
    'Refresh your claim deadline. Call at least every 60 seconds while working — three missed heartbeats requeue the task for another attempt. You may attach a usage increment.',
  log_step:
    "Record one plain-English step of your work (e.g. 'Read the task and gathered context'). These steps become the activity report a business user and their auditor read, so call it for each meaningful unit of work. Optionally attach the usage spent on this step.",
  report_usage:
    "Report token usage from one LLM API call — call it after each LLM call, passing the usage block from the provider's response. Palouse prices it against its model catalog so people can see what the work cost. If your agent exports OpenTelemetry GenAI traces to Palouse you do not need report_usage.",
  request_review:
    'Hand your work to a human reviewer and pause: moves the handoff to needs_review with your summary.',
  complete_task:
    'Finish the handoff with a result summary. If the handoff requires review it moves to needs_review instead of completed.',
  fail_task: 'Give up on the handoff with a reason. Terminal — the claim token stops working.',
  list_decisions:
    'List decision-log records in your workspace, filterable by stage, area, and title search. Use this to find an existing decision before creating a new one (e.g. when a meeting revisited a decision already on record).',
  get_decision:
    'Fetch one decision with its RACI stakeholders, supporting resources, related entities, and full comment thread.',
  create_decision:
    'Create a decision-log record on behalf of the team. Use this when a discussion (for example a meeting transcript you were asked to review) produced a decision worth tracking. Capture what is being decided in the title, the options weighed and reasoning in the description, and set the area to the project or topic. It is marked as agent-originated. If you can identify the people involved, pass the RACI stakeholders; otherwise leave them for a human to fill in. Search first with list_decisions so you update an existing record instead of duplicating it.',
  update_decision:
    'Update a decision record: refine its title/description/area or advance its stage (proposed → under_review → accepted → rejected → deprecated → superseded). Use this when a later discussion moved an existing decision forward. Moving to accepted requires exactly one accountable stakeholder.',
  add_decision_comment:
    'Append a comment to a decision. Use it to record team feedback or a summary of what a discussion added to the decision, so the thread reflects how thinking evolved.',
  set_decision_stakeholders:
    "Replace a decision's RACI roster in full (responsible, accountable, consulted, informed). At most one accountable is allowed. Pass Palouse user ids.",
  add_decision_relation:
    'Link a decision to a related entity so the record sits alongside the work it concerns. Task, goal (objective), and key_result links resolve to a title and status on read (via get_decision), and goal/key_result links surface on the objective via get_objective. Project, project_item, and context are reserved.',
  list_objectives:
    'List the goals (objectives) your workspace is working toward, filterable by status, area, and title search. Use this to find an existing objective before creating a new one, and to report progress on the goals a person cares about.',
  get_objective:
    "Fetch one objective with its key results, including each key result's current value and computed progress toward its target.",
  create_objective:
    'Create a goal (objective) for the team, optionally with its measurable key results. Use this when a person sets an OKR or KPI worth tracking. Put the goal in the title, the reasoning and definition of success in the description, and set the area to the team or theme. Give each key result a start value, a target value, and a unit so progress can be measured. It is marked as agent-originated. Search first with list_objectives so you update an existing goal instead of duplicating it.',
  update_objective:
    'Update an objective: refine its title, description, area, or target date, or change its status (planning, active, at_risk, achieved, missed, archived). Use this when a goal is adopted, put at risk, or reached.',
  list_projects:
    'List the projects (Kanban boards) in your workspace, filterable by status and name search. Each project reports how many cards it has and how many are done. Use this to find an existing project before creating a new one.',
  get_project:
    "Fetch one project with its columns and cards, including each card's column, completion, timeline dates, and its linked tasks and decisions.",
  create_project:
    'Create a project (a lightweight Kanban board) for the team. It comes seeded with To do, In progress, and Done columns; cards in the Done column count as complete. Put the project name in the title and its aim in the description. It is marked as agent-originated. Search first with list_projects so you extend an existing project instead of duplicating it.',
  update_project:
    'Update a project: refine its name or description, or change its status (planning, active, on_hold, completed, archived).',
  create_project_item:
    'Add a card to a project. Defaults to the first column unless you pass a columnId. Give it a title and optional detail, and set startDate/endDate to place it on the timeline. Adding it to a done column (or passing completed) marks it complete, which feeds any key result this project ladders up to.',
  update_project_item:
    'Update a card: change its title or detail, move it to another column, set its timeline dates, or mark it done. Moving a card into a done column marks it complete; completion drives the progress of any key result the project is laddered to.',
};

/** `palouse://` resource URI templates exposed by the MCP server. */
export const RESOURCES = {
  tasks: 'palouse://workspaces/{wsId}/tasks',
  task: 'palouse://workspaces/{wsId}/tasks/{taskId}',
  queuedHandoffs: 'palouse://workspaces/{wsId}/handoffs/queued',
} as const;

export { handoffState, taskStatus };
