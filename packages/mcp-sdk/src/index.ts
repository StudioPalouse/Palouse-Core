// Tool/resource definitions shared between apps/mcp and any future SDKs.
// Full tool schemas land in M5 per docs/architecture.md §6.
export const TOOLS = [
  'list_tasks',
  'get_task',
  'claim_task',
  'update_task',
  'add_comment',
  'heartbeat',
  'request_review',
  'complete_task',
  'fail_task',
] as const;

export type ToolName = (typeof TOOLS)[number];
