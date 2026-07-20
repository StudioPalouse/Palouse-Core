import type {
  Agent,
  AgentApiKey,
  AgentKind,
  AgentKeyScope,
  AuditEventListItem,
  AuditVerifyResult,
  AddRelationInput,
  AddResourceInput,
  CapabilityKey,
  CreateDecisionInput,
  CreateTaskInput,
  Decision,
  DecisionComment,
  DecisionDetail,
  DecisionListItem,
  DecisionRelation,
  DecisionResource,
  DecisionStakeholder,
  StrategySignals,
  Handoff,
  HandoffEvent,
  HandoffListItem,
  HandoffNarrative,
  HandoffState,
  HandoffStep,
  HandoffUsageSummary,
  CreateKeyResultInput,
  CreateObjectiveInput,
  Integration,
  Invitation,
  InviteRole,
  KeyResult,
  LlmGeneration,
  Objective,
  ObjectiveDetail,
  ObjectiveImportResult,
  ObjectiveListItem,
  CreateColumnInput,
  CreateProjectInput,
  CreateProjectItemInput,
  Project,
  ProjectColumn,
  ProjectDetail,
  ProjectItem,
  ProjectListItem,
  UpdateColumnInput,
  UpdateProjectInput,
  UpdateProjectItemInput,
  ReviewDecision,
  MemberRole,
  MembershipStatus,
  StakeholderAssignment,
  Task,
  TaskComment,
  TaskListItem,
  TaskSource,
  UpdateDecisionInput,
  UpdateKeyResultInput,
  UpdateObjectiveInput,
  UpdateTaskInput,
  UsageSummaryRow,
  Workspace,
  WorkspaceCapabilities,
  WorkspaceMember,
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

  requestWorkspaceDeletion: (workspaceId: string, confirmName: string) =>
    request<{ requested: boolean }>(`/v1/workspaces/${workspaceId}/deletion`, {
      method: 'POST',
      body: JSON.stringify({ confirmName }),
    }),

  confirmWorkspaceDeletion: (token: string) =>
    request<{ workspaceId: string }>('/v1/workspaces/deletion/confirm', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  getCapabilities: (workspaceId: string) =>
    request<{ capabilities: WorkspaceCapabilities }>(`/v1/workspaces/${workspaceId}/capabilities`),

  setCapability: (workspaceId: string, capability: CapabilityKey, enabled: boolean) =>
    request<{ capabilities: WorkspaceCapabilities }>(
      `/v1/workspaces/${workspaceId}/capabilities/${capability}`,
      { method: 'PATCH', body: JSON.stringify({ enabled }) },
    ),

  // MCP OAuth connect flow (docs/PLAN-mcp-oauth.md)
  getMcpSelection: () =>
    request<{
      selection: {
        workspaceId: string;
        workspaceName: string;
        agentId: string;
        clientId: string;
      } | null;
    }>('/v1/mcp-connect/selection'),

  selectMcpWorkspace: (input: { workspaceId: string; clientId: string }) =>
    request<{ agentId: string }>('/v1/mcp-connect/selection', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  listMembers: (workspaceId: string) =>
    request<{ members: WorkspaceMember[] }>(`/v1/workspaces/${workspaceId}/members`),

  updateMemberRole: (workspaceId: string, userId: string, role: MemberRole) =>
    request<{ member: WorkspaceMember }>(`/v1/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  setMemberStatus: (workspaceId: string, userId: string, status: MembershipStatus) =>
    request<{ member: WorkspaceMember }>(`/v1/workspaces/${workspaceId}/members/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  removeMember: (workspaceId: string, userId: string) =>
    request<void>(`/v1/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE' }),

  transferOwnership: (workspaceId: string, targetUserId: string) =>
    request<{ newOwner: WorkspaceMember; previousOwner: WorkspaceMember }>(
      `/v1/workspaces/${workspaceId}/transfer-ownership`,
      { method: 'POST', body: JSON.stringify({ targetUserId }) },
    ),

  leaveWorkspace: (workspaceId: string) =>
    request<void>(`/v1/workspaces/${workspaceId}/leave`, { method: 'POST' }),

  listInvites: (workspaceId: string) =>
    request<{ invitations: Invitation[] }>(`/v1/workspaces/${workspaceId}/invitations`),

  createInvite: (workspaceId: string, input: { email: string; role: InviteRole }) =>
    request<{ invitation: Invitation }>(`/v1/workspaces/${workspaceId}/invitations`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  revokeInvite: (workspaceId: string, inviteId: string) =>
    request<void>(`/v1/workspaces/${workspaceId}/invitations/${inviteId}`, { method: 'DELETE' }),

  resendInvite: (workspaceId: string, inviteId: string) =>
    request<{ invitation: Invitation }>(
      `/v1/workspaces/${workspaceId}/invitations/${inviteId}/resend`,
      { method: 'POST' },
    ),

  acceptInvite: (token: string) =>
    request<{ workspaceId: string }>('/v1/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  listTasks: (
    workspaceId: string,
    params?: { status?: string; search?: string; limit?: number },
  ) => {
    const qs = new URLSearchParams({ workspaceId });
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    return request<{ tasks: TaskListItem[]; total: number }>(`/v1/tasks?${qs}`);
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

  listDecisions: (
    workspaceId: string,
    params?: { status?: string; area?: string; search?: string; limit?: number },
  ) => {
    const qs = new URLSearchParams({ workspaceId });
    if (params?.status) qs.set('status', params.status);
    if (params?.area) qs.set('area', params.area);
    if (params?.search) qs.set('search', params.search);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    return request<{ decisions: DecisionListItem[]; total: number }>(`/v1/decisions?${qs}`);
  },

  getDecision: (workspaceId: string, decisionId: string) =>
    request<DecisionDetail>(`/v1/decisions/${decisionId}?workspaceId=${workspaceId}`),

  getStrategySignals: (workspaceId: string) =>
    request<StrategySignals>(`/v1/decisions/strategy-signals?workspaceId=${workspaceId}`),

  createDecision: (workspaceId: string, input: CreateDecisionInput) =>
    request<{ decision: Decision }>('/v1/decisions', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  updateDecision: (workspaceId: string, decisionId: string, input: UpdateDecisionInput) =>
    request<{ decision: Decision }>(`/v1/decisions/${decisionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  addDecisionComment: (workspaceId: string, decisionId: string, bodyMd: string) =>
    request<{ comment: DecisionComment }>(`/v1/decisions/${decisionId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, bodyMd }),
    }),

  setDecisionStakeholders: (
    workspaceId: string,
    decisionId: string,
    stakeholders: StakeholderAssignment[],
  ) =>
    request<{ stakeholders: DecisionStakeholder[] }>(`/v1/decisions/${decisionId}/stakeholders`, {
      method: 'PUT',
      body: JSON.stringify({ workspaceId, stakeholders }),
    }),

  addDecisionResource: (workspaceId: string, decisionId: string, input: AddResourceInput) =>
    request<{ resource: DecisionResource }>(`/v1/decisions/${decisionId}/resources`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  removeDecisionResource: (workspaceId: string, decisionId: string, resourceId: string) =>
    request<void>(
      `/v1/decisions/${decisionId}/resources/${resourceId}?workspaceId=${workspaceId}`,
      { method: 'DELETE' },
    ),

  addDecisionRelation: (workspaceId: string, decisionId: string, input: AddRelationInput) =>
    request<{ relation: DecisionRelation }>(`/v1/decisions/${decisionId}/relations`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  removeDecisionRelation: (workspaceId: string, decisionId: string, relationId: string) =>
    request<void>(
      `/v1/decisions/${decisionId}/relations/${relationId}?workspaceId=${workspaceId}`,
      { method: 'DELETE' },
    ),

  listObjectives: (
    workspaceId: string,
    params?: { status?: string; area?: string; search?: string; limit?: number },
  ) => {
    const qs = new URLSearchParams({ workspaceId });
    if (params?.status) qs.set('status', params.status);
    if (params?.area) qs.set('area', params.area);
    if (params?.search) qs.set('search', params.search);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    return request<{ objectives: ObjectiveListItem[]; total: number }>(`/v1/objectives?${qs}`);
  },

  getObjective: (workspaceId: string, objectiveId: string) =>
    request<ObjectiveDetail>(`/v1/objectives/${objectiveId}?workspaceId=${workspaceId}`),

  listAuditEvents: (
    workspaceId: string,
    params?: {
      action?: string;
      actorType?: 'user' | 'agent';
      targetType?: string;
      targetId?: string;
      search?: string;
      includeReads?: boolean;
      limit?: number;
      offset?: number;
    },
  ) => {
    const qs = new URLSearchParams({ workspaceId });
    if (params?.action) qs.set('action', params.action);
    if (params?.actorType) qs.set('actorType', params.actorType);
    if (params?.targetType) qs.set('targetType', params.targetType);
    if (params?.targetId) qs.set('targetId', params.targetId);
    if (params?.search) qs.set('search', params.search);
    if (params?.includeReads) qs.set('includeReads', 'true');
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.offset != null) qs.set('offset', String(params.offset));
    return request<{ events: AuditEventListItem[]; total: number }>(`/v1/audit/events?${qs}`);
  },

  verifyAudit: (workspaceId: string) =>
    request<AuditVerifyResult>(`/v1/audit/verify?workspaceId=${workspaceId}`),

  createObjective: (workspaceId: string, input: CreateObjectiveInput) =>
    request<{ objective: Objective }>('/v1/objectives', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  updateObjective: (workspaceId: string, objectiveId: string, input: UpdateObjectiveInput) =>
    request<{ objective: Objective }>(`/v1/objectives/${objectiveId}`, {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  addKeyResult: (workspaceId: string, objectiveId: string, input: CreateKeyResultInput) =>
    request<{ keyResult: KeyResult }>(`/v1/objectives/${objectiveId}/key-results`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  updateKeyResult: (
    workspaceId: string,
    objectiveId: string,
    keyResultId: string,
    input: UpdateKeyResultInput,
  ) =>
    request<{ keyResult: KeyResult }>(`/v1/objectives/${objectiveId}/key-results/${keyResultId}`, {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  removeKeyResult: (workspaceId: string, objectiveId: string, keyResultId: string) =>
    request<void>(
      `/v1/objectives/${objectiveId}/key-results/${keyResultId}?workspaceId=${workspaceId}`,
      { method: 'DELETE' },
    ),

  importObjectives: (workspaceId: string, csv: string, dryRun: boolean) =>
    request<ObjectiveImportResult>('/v1/objectives/import', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, csv, dryRun }),
    }),

  linkKeyResultProject: (
    workspaceId: string,
    objectiveId: string,
    keyResultId: string,
    projectId: string,
  ) =>
    request<void>(`/v1/objectives/${objectiveId}/key-results/${keyResultId}/projects`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, projectId }),
    }),

  unlinkKeyResultProject: (
    workspaceId: string,
    objectiveId: string,
    keyResultId: string,
    projectId: string,
  ) =>
    request<void>(
      `/v1/objectives/${objectiveId}/key-results/${keyResultId}/projects/${projectId}?workspaceId=${workspaceId}`,
      { method: 'DELETE' },
    ),

  listProjects: (
    workspaceId: string,
    params?: { status?: string; search?: string; limit?: number },
  ) => {
    const qs = new URLSearchParams({ workspaceId });
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    return request<{ projects: ProjectListItem[]; total: number }>(`/v1/projects?${qs}`);
  },

  getProject: (workspaceId: string, projectId: string) =>
    request<ProjectDetail>(`/v1/projects/${projectId}?workspaceId=${workspaceId}`),

  createProject: (workspaceId: string, input: CreateProjectInput) =>
    request<{ project: Project }>('/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  updateProject: (workspaceId: string, projectId: string, input: UpdateProjectInput) =>
    request<{ project: Project }>(`/v1/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  deleteProject: (workspaceId: string, projectId: string) =>
    request<void>(`/v1/projects/${projectId}?workspaceId=${workspaceId}`, { method: 'DELETE' }),

  addProjectColumn: (workspaceId: string, projectId: string, input: CreateColumnInput) =>
    request<{ column: ProjectColumn }>(`/v1/projects/${projectId}/columns`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  updateProjectColumn: (
    workspaceId: string,
    projectId: string,
    columnId: string,
    input: UpdateColumnInput,
  ) =>
    request<{ column: ProjectColumn }>(`/v1/projects/${projectId}/columns/${columnId}`, {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  removeProjectColumn: (workspaceId: string, projectId: string, columnId: string) =>
    request<void>(`/v1/projects/${projectId}/columns/${columnId}?workspaceId=${workspaceId}`, {
      method: 'DELETE',
    }),

  createProjectItem: (workspaceId: string, projectId: string, input: CreateProjectItemInput) =>
    request<{ item: ProjectItem }>(`/v1/projects/${projectId}/items`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  updateProjectItem: (
    workspaceId: string,
    projectId: string,
    itemId: string,
    input: UpdateProjectItemInput,
  ) =>
    request<{ item: ProjectItem }>(`/v1/projects/${projectId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  removeProjectItem: (workspaceId: string, projectId: string, itemId: string) =>
    request<void>(`/v1/projects/${projectId}/items/${itemId}?workspaceId=${workspaceId}`, {
      method: 'DELETE',
    }),

  addProjectDependency: (
    workspaceId: string,
    projectId: string,
    input: { predecessorItemId: string; successorItemId: string },
  ) =>
    request<void>(`/v1/projects/${projectId}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...input }),
    }),

  removeProjectDependency: (workspaceId: string, projectId: string, dependencyId: string) =>
    request<void>(
      `/v1/projects/${projectId}/dependencies/${dependencyId}?workspaceId=${workspaceId}`,
      { method: 'DELETE' },
    ),

  linkProjectItemTask: (workspaceId: string, projectId: string, itemId: string, taskId: string) =>
    request<void>(`/v1/projects/${projectId}/items/${itemId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, taskId }),
    }),

  unlinkProjectItemTask: (workspaceId: string, projectId: string, itemId: string, taskId: string) =>
    request<void>(
      `/v1/projects/${projectId}/items/${itemId}/tasks/${taskId}?workspaceId=${workspaceId}`,
      { method: 'DELETE' },
    ),

  linkProjectItemDecision: (
    workspaceId: string,
    projectId: string,
    itemId: string,
    decisionId: string,
  ) =>
    request<void>(`/v1/projects/${projectId}/items/${itemId}/decisions`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, decisionId }),
    }),

  unlinkProjectItemDecision: (
    workspaceId: string,
    projectId: string,
    itemId: string,
    decisionId: string,
  ) =>
    request<void>(
      `/v1/projects/${projectId}/items/${itemId}/decisions/${decisionId}?workspaceId=${workspaceId}`,
      { method: 'DELETE' },
    ),

  listAgents: (workspaceId: string, opts?: { includeArchived?: boolean }) =>
    request<{ agents: Agent[] }>(
      `/v1/agents?workspaceId=${workspaceId}${opts?.includeArchived ? '&includeArchived=true' : ''}`,
    ),

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

  deleteAgent: (workspaceId: string, agentId: string) =>
    request<void>(`/v1/agents/${agentId}?workspaceId=${workspaceId}`, { method: 'DELETE' }),

  archiveAgent: (workspaceId: string, agentId: string) =>
    request<{ agent: Agent }>(`/v1/agents/${agentId}/archive`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    }),

  unarchiveAgent: (workspaceId: string, agentId: string) =>
    request<{ agent: Agent }>(`/v1/agents/${agentId}/archive?workspaceId=${workspaceId}`, {
      method: 'DELETE',
    }),

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
    params?: {
      state?: HandoffState;
      taskId?: string;
      agentId?: string;
      active?: boolean;
      limit?: number;
    },
  ) => {
    const qs = new URLSearchParams({ workspaceId });
    if (params?.state) qs.set('state', params.state);
    if (params?.taskId) qs.set('taskId', params.taskId);
    if (params?.agentId) qs.set('agentId', params.agentId);
    if (params?.active) qs.set('active', 'true');
    if (params?.limit != null) qs.set('limit', String(params.limit));
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

/** Shareable link an IT admin opens to approve the app for their whole tenant. */
export function adminConsentUrl(provider: string): string {
  return `${API_URL}/oauth/${provider}/admin-consent`;
}

export { ApiError };
