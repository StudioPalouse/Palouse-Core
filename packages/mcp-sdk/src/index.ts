// Tool/resource definitions shared between apps/mcp and any future SDKs.
// One entry per tool from docs/architecture.md §6: Zod input shape + the
// description agents see. Keeping these here guarantees server and client
// SDKs never drift.
import { z } from 'zod';
import { handoffState, taskStatus } from '@palouse/shared';

export const TOOLS = [
  'list_tasks',
  'get_task',
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

export type ToolName = (typeof TOOLS)[number];

const taskId = z.string().uuid().describe('Palouse task id (uuid)');
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
  model: z.string().min(1).max(200).describe("Model id as the provider reports it, e.g. 'claude-opus-4-8'"),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  costUsd: z
    .number()
    .nonnegative()
    .optional()
    .describe('Your own cost estimate, if you have one. Stored separately; Palouse computes the official cost from its price catalog.'),
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
      .describe("Plain-English step title a business user will read, e.g. 'Drafted the Q2 summary'"),
    detail: z.string().max(20_000).optional().describe('Optional detail (markdown)'),
    status: z.enum(['started', 'completed', 'failed']).optional().describe("Defaults to 'completed'"),
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
    summary: z.string().min(1).max(20_000).describe('What you did and what the reviewer should check (markdown)'),
  },
  complete_task: {
    claimToken,
    resultSummaryMd: z.string().min(1).max(20_000).describe('Plain-English summary of the result (markdown)'),
    usage: optionalUsage,
  },
  fail_task: {
    claimToken,
    reason: z.string().min(1).max(4000).describe('Why the task could not be finished'),
    usage: optionalUsage,
  },
} satisfies Record<ToolName, z.ZodRawShape>;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  list_tasks: 'List tasks in your workspace, filterable by status and title search.',
  get_task: 'Fetch one task with its comments and full agent handoff history.',
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
};

/** `palouse://` resource URI templates exposed by the MCP server. */
export const RESOURCES = {
  tasks: 'palouse://workspaces/{wsId}/tasks',
  task: 'palouse://workspaces/{wsId}/tasks/{taskId}',
  queuedHandoffs: 'palouse://workspaces/{wsId}/handoffs/queued',
} as const;

export { handoffState, taskStatus };
