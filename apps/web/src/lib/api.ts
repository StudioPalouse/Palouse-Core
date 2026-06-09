import type {
  CreateTaskInput,
  Integration,
  Task,
  TaskComment,
  TaskSource,
  UpdateTaskInput,
  Workspace,
} from '@reqops/shared';
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
