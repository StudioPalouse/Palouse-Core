import type { ExternalSystem, Task } from '@palouse/shared';

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

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
  externalAccountId?: string;
  accountLabel: string;
}

export interface RefreshedTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface PullContext {
  integrationId: string;
  workspaceId: string;
  accessToken: string;
  /** Provider-specific incremental cursor (e.g. RFC3339 updatedMin). */
  cursor?: string;
  /**
   * Per-connection config stored on the integration row (provider-specific).
   * Notion uses it to carry the resolved data-source id + property field map,
   * since it can't auto-discover what to sync the way Asana/Google can.
   */
  config?: unknown;
}

export interface PullResult {
  tasks: NormalizedExternalTask[];
  nextCursor?: string;
}

/** Outbound change pushed back to the originating system. */
export interface PushPayload {
  externalId: string;
  /**
   * System the task_sources row came from. Adapters that front more than one
   * external system (ms_tasks wraps To Do + Planner) route on this.
   */
  externalSystem?: ExternalSystem;
  title?: string;
  status?: Task['status'];
  dueAt?: string | null;
  descriptionMd?: string | null;
}

export interface WebhookSubscription {
  subscriptionId: string;
  expiresAt?: Date;
}

export interface ConnectorAdapter {
  readonly system: ExternalSystem;
  /** True when the provider has no webhooks and must be polled. */
  readonly pollOnly: boolean;

  buildAuthUrl(input: { config: OAuthClientConfig; redirectUri: string; state: string }): string;

  exchangeCode(input: {
    config: OAuthClientConfig;
    redirectUri: string;
    code: string;
  }): Promise<OAuthTokenSet>;

  refreshTokens?(input: {
    config: OAuthClientConfig;
    refreshToken: string;
  }): Promise<RefreshedTokens>;

  pull(ctx: PullContext): Promise<PullResult>;

  push?(ctx: PullContext, payload: PushPayload): Promise<void>;

  subscribeWebhook?(
    ctx: PullContext,
    callbackUrl: string,
    /** clientState: random per-subscription secret; never the integration id. */
    opts?: { clientState?: string },
  ): Promise<WebhookSubscription>;

  /** Extends an expiring subscription (MS Graph caps lifetimes at ~3 days). */
  renewWebhook?(ctx: PullContext, subscriptionId: string): Promise<WebhookSubscription>;
}

export class ConnectorHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message?: string,
  ) {
    super(message ?? `Connector HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

/** fetch wrapper that throws ConnectorHttpError on non-2xx. */
export async function connectorFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new ConnectorHttpError(res.status, await res.text().catch(() => ''));
  }
  return res;
}
