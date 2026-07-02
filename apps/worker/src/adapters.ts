import type { ConnectorAdapter, OAuthClientConfig } from '@palouse/connector-core';
import { googleTasksAdapter } from '@palouse/connector-google-tasks';
import { asanaAdapter } from '@palouse/connector-asana';
import { microsoftTasksAdapter } from '@palouse/connector-microsoft-tasks';
import { microsoftTodoAdapter } from '@palouse/connector-microsoft-todo';
import { microsoftPlannerAdapter } from '@palouse/connector-microsoft-planner';
import { notionAdapter } from '@palouse/connector-notion';
import type { Env } from '@palouse/config';
import type { IntegrationProvider } from '@palouse/shared';

const ADAPTERS: Partial<Record<IntegrationProvider, ConnectorAdapter>> = {
  google_tasks: googleTasksAdapter,
  asana: asanaAdapter,
  ms_tasks: microsoftTasksAdapter,
  // Legacy per-product Microsoft connections; new connects use ms_tasks.
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
    ms_tasks: [env.MICROSOFT_OAUTH_CLIENT_ID, env.MICROSOFT_OAUTH_CLIENT_SECRET],
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
  // Planner has no webhooks, so the unified connection polls at Planner's
  // cadence; the To Do half also gets change notifications.
  ms_tasks: 120_000,
  ms_todo: 300_000,
  ms_planner: 120_000,
  // N1 is poll-only (webhooks land in N2); Notion's 3 req/s limit wants a gentle cadence.
  notion: 300_000,
};
