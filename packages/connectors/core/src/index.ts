import type { ExternalSystem, Task } from '@reqops/shared';

/** Shape that every external task gets normalized into before upsert. */
export interface NormalizedExternalTask {
  externalSystem: ExternalSystem;
  externalId: string;
  externalUrl?: string;
  externalEtag?: string;
  externalUpdatedAt?: string;
  title: string;
  descriptionMd?: string;
  status: Task['status'];
  dueAt?: string;
}

export interface OAuthStartResult {
  authorizationUrl: string;
  state: string;
}

export interface OAuthCallbackInput {
  code: string;
  state: string;
  workspaceId: string;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
  externalAccountId?: string;
  accountLabel: string;
}

export interface PullContext {
  integrationId: string;
  workspaceId: string;
  accessToken: string;
  cursor?: string;
}

export interface PullResult {
  tasks: NormalizedExternalTask[];
  nextCursor?: string;
}

export interface ConnectorAdapter {
  readonly system: ExternalSystem;
  oauthStart(input: { workspaceId: string; redirectUri: string }): Promise<OAuthStartResult>;
  oauthCallback(input: OAuthCallbackInput): Promise<OAuthTokenSet>;
  pull(ctx: PullContext): Promise<PullResult>;
  push?(ctx: PullContext, task: NormalizedExternalTask): Promise<void>;
  subscribeWebhook?(ctx: PullContext, callbackUrl: string): Promise<{ subscriptionId: string; expiresAt?: Date }>;
  handleWebhook?(ctx: { rawBody: string; headers: Record<string, string> }): Promise<NormalizedExternalTask[]>;
}
