import type { ConnectorAdapter, OAuthClientConfig } from '@palouse/connector-core';
import { googleTasksAdapter } from '@palouse/connector-google-tasks';
import { asanaAdapter } from '@palouse/connector-asana';
import { microsoftTodoAdapter } from '@palouse/connector-microsoft-todo';
import { microsoftPlannerAdapter } from '@palouse/connector-microsoft-planner';
import { notionAdapter } from '@palouse/connector-notion';
import type { Env } from '@palouse/config';
import { validation, type IntegrationProvider } from '@palouse/shared';

const ADAPTERS: Partial<Record<IntegrationProvider, ConnectorAdapter>> = {
  google_tasks: googleTasksAdapter,
  asana: asanaAdapter,
  ms_todo: microsoftTodoAdapter,
  ms_planner: microsoftPlannerAdapter,
  notion: notionAdapter,
};

export function adapterFor(provider: IntegrationProvider): ConnectorAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw validation(`Provider not yet supported: ${provider}`);
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
    throw validation(
      `OAuth client for ${provider} is not configured — set the *_OAUTH_CLIENT_ID/SECRET env vars`,
    );
  }
  return { clientId, clientSecret };
}
