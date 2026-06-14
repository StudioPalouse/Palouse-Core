import type { ConnectorAdapter, OAuthClientConfig } from '@reqops/connector-core';
import { googleTasksAdapter } from '@reqops/connector-google-tasks';
import { asanaAdapter } from '@reqops/connector-asana';
import { microsoftTodoAdapter } from '@reqops/connector-microsoft-todo';
import { microsoftPlannerAdapter } from '@reqops/connector-microsoft-planner';
import { notionAdapter } from '@reqops/connector-notion';
import type { Env } from '@reqops/config';
import type { IntegrationProvider } from '@reqops/shared';

const ADAPTERS: Partial<Record<IntegrationProvider, ConnectorAdapter>> = {
  google_tasks: googleTasksAdapter,
  asana: asanaAdapter,
  ms_todo: microsoftTodoAdapter,
  ms_planner: microsoftPlannerAdapter,
  notion: notionAdapter,
};

export function adapterFor(provider: IntegrationProvider): ConnectorAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`No connector adapter for provider: ${provider}`);
  return adapter;
}

export function oauthConfigFor(env: Env, provider: IntegrationProvider): OAuthClientConfig {
  // Notion connects with an internal integration token (no OAuth client), so it
  // has no entry here — the token-connect path never calls oauthConfigFor.
  const pair: Partial<Record<IntegrationProvider, [string | undefined, string | undefined]>> = {
    google_tasks: [env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET],
    ms_todo: [env.MICROSOFT_OAUTH_CLIENT_ID, env.MICROSOFT_OAUTH_CLIENT_SECRET],
    ms_planner: [env.MICROSOFT_OAUTH_CLIENT_ID, env.MICROSOFT_OAUTH_CLIENT_SECRET],
    asana: [env.ASANA_OAUTH_CLIENT_ID, env.ASANA_OAUTH_CLIENT_SECRET],
  };
  const [clientId, clientSecret] = pair[provider] ?? [];
  if (!clientId || !clientSecret) {
    throw new Error(`OAuth client not configured for ${provider} — set the env vars in .env`);
  }
  return { clientId, clientSecret };
}

/**
 * Poll cadence per provider (ms). Google Tasks and Planner have no webhooks;
 * Asana and MS To Do polling is a fallback behind their webhook subscriptions.
 */
export const POLL_INTERVAL_MS: Partial<Record<IntegrationProvider, number>> = {
  google_tasks: 60_000,
  asana: 300_000,
  ms_todo: 300_000,
  ms_planner: 120_000,
  // N1 is poll-only (webhooks land in N2); Notion's 3 req/s limit wants a gentle cadence.
  notion: 300_000,
};
