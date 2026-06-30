import type {
  Agent,
  AgentApiKey,
  AgentKind,
  AgentKeyScope,
  CreateTaskInput,
  Handoff,
  HandoffEvent,
  HandoffListItem,
  HandoffNarrative,
  HandoffState,
  HandoffStep,
  HandoffUsageSummary,
  Integration,
  LlmGeneration,
  ReviewDecision,
  Task,
  TaskComment,
  TaskSource,
  UpdateTaskInput,
  UsageSummaryRow,
  Workspace,
} from '@palouse/shared';
import { API_URL } from './auth-client';

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = body?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'INTERNAL', err.message ?? res.statusText);
  }
  // 204 No Content (e.g. key revoke) has no body to parse.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listWorkspaces: () => request<{ workspaces: Workspace[] }>('/v1/workspaces'),

  createWorkspace: (input: { name: string; slug: string }) =>
    request<{ workspace: Workspace }>('/v1/workspaces', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  listTasks: (workspaceId: string, params?: { status?: string; search?: string }) => {
    const qs = new URLSearchParams({ workspaceId, ...params });
    return request<{ tasks: Task[]; total: number }>(`/v1/tasks?${qs}`);
  },

  getTask: (workspaceId: string, taskId: string) =>
    request<{ task: Task; comments: TaskComment[]; sources: TaskSource[] }>(
      `/v1/tasks/${taskId}?workspaceId=${workspaceId}`,
    ),

  createTask: (workspaceId: string, input: CreateTaskInput) =>
    request<{ task: Task }>('/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  updateTask: (workspaceId: string, taskId: string, input: UpdateTaskInput) =>
    request<{ task: Task }>(`/v1/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  addComment: (workspaceId: string, taskId: string, bodyMd: string) =>
    request<{ comment: TaskComment }>(`/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, bodyMd }),
    }),

  listAgents: (workspaceId: string) =>
    request<{ agents: Agent[] }>(`/v1/agents?workspaceId=${workspaceId}`),

  createAgent: (
    workspaceId: string,
    input: { name: string; kind: AgentKind; metadata?: Record<string, unknown> },
  ) =>
    request<{ agent: Agent }>('/v1/agents', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  getAgent: (workspaceId: string, agentId: string) =>
    request<{ agent: Agent; keys: AgentApiKey[] }>(
      `/v1/agents/${agentId}?workspaceId=${workspaceId}`,
    ),

  createAgentKey: (workspaceId: string, agentId: string, input: { scopes: AgentKeyScope[] }) =>
    request<{ key: AgentApiKey; plaintext: string }>(`/v1/agents/${agentId}/keys`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  revokeAgentKey: (workspaceId: string, agentId: string, keyId: string) =>
    request<void>(`/v1/agents/${agentId}/keys/${keyId}?workspaceId=${workspaceId}`, {
      method: 'DELETE',
    }),

  createHandoff: (
    workspaceId: string,
    taskId: string,
    input: { agentId: string; reviewRequired?: boolean; deadlineMinutes?: number },
  ) =>
    request<{ handoff: Handoff }>(`/v1/tasks/${taskId}/handoff`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  listHandoffs: (
    workspaceId: string,
    params?: { state?: HandoffState; taskId?: string; agentId?: string },
  ) => {
    const qs = new URLSearchParams({ workspaceId, ...params });
    return request<{ handoffs: HandoffListItem[]; total: number }>(`/v1/handoffs?${qs}`);
  },

  getHandoff: (workspaceId: string, handoffId: string) =>
    request<{
      handoff: Handoff;
      events: HandoffEvent[];
      taskTitle: string | null;
      agentName: string | null;
      steps: HandoffStep[];
      generations: LlmGeneration[];
      summary: HandoffUsageSummary;
      narrative: HandoffNarrative;
    }>(`/v1/handoffs/${handoffId}?workspaceId=${workspaceId}`),

  getUsageSummary: (
    workspaceId: string,
    params?: { agentId?: string; from?: string; to?: string; groupBy?: 'agent' | 'model' | 'day' },
  ) => {
    const qs = new URLSearchParams({ workspaceId, ...params });
    return request<{ rows: UsageSummaryRow[]; totalCostUsd: number }>(`/v1/usage/summary?${qs}`);
  },

  reviewHandoff: (
    workspaceId: string,
    handoffId: string,
    input: { decision: ReviewDecision; note?: string; rejectAction?: 'retry' | 'fail' },
  ) =>
    request<{ handoff: Handoff }>(`/v1/handoffs/${handoffId}/review`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  cancelHandoff: (workspaceId: string, handoffId: string) =>
    request<{ handoff: Handoff }>(`/v1/handoffs/${handoffId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    }),

  listIntegrations: (workspaceId: string) =>
    request<{ integrations: Integration[] }>(`/v1/integrations?workspaceId=${workspaceId}`),

  syncIntegration: (workspaceId: string, id: string) =>
    request<{ queued: boolean }>(`/v1/integrations/${id}/sync?workspaceId=${workspaceId}`, {
      method: 'POST',
    }),

  deleteIntegration: (workspaceId: string, id: string) =>
    request<{ deleted: boolean }>(`/v1/integrations/${id}?workspaceId=${workspaceId}`, {
      method: 'DELETE',
    }),
};

/** Browser navigation target that starts a connector OAuth flow (carries cookies). */
export function oauthStartUrl(provider: string, workspaceId: string): string {
  return `${API_URL}/oauth/${provider}/start?workspaceId=${workspaceId}`;
}

export { ApiError };
