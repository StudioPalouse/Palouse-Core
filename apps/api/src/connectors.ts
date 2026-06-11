import type { ConnectorAdapter, OAuthClientConfig } from '@reqops/connector-core';
import { googleTasksAdapter } from '@reqops/connector-google-tasks';
import { asanaAdapter } from '@reqops/connector-asana';
import { microsoftTodoAdapter } from '@reqops/connector-microsoft-todo';
import { microsoftPlannerAdapter } from '@reqops/connector-microsoft-planner';
import type { Env } from '@reqops/config';
import { validation, type IntegrationProvider } from '@reqops/shared';

const ADAPTERS: Partial<Record<IntegrationProvider, ConnectorAdapter>> = {
  google_tasks: googleTasksAdapter,
  asana: asanaAdapter,
  ms_todo: microsoftTodoAdapter,
  ms_planner: microsoftPlannerAdapter,
};

export function adapterFor(provider: IntegrationProvider): ConnectorAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw validation(`Provider not yet supported: ${provider}`);
  return adapter;
}

export function oauthConfigFor(env: Env, provider: IntegrationProvider): OAuthClientConfig {
  const pair: Record<IntegrationProvider, [string | undefined, string | undefined]> = {
    google_tasks: [env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET],
    ms_todo: [env.MICROSOFT_OAUTH_CLIENT_ID, env.MICROSOFT_OAUTH_CLIENT_SECRET],
    ms_planner: [env.MICROSOFT_OAUTH_CLIENT_ID, env.MICROSOFT_OAUTH_CLIENT_SECRET],
    asana: [env.ASANA_OAUTH_CLIENT_ID, env.ASANA_OAUTH_CLIENT_SECRET],
  };
  const [clientId, clientSecret] = pair[provider];
  if (!clientId || !clientSecret) {
    throw validation(
      `OAuth client for ${provider} is not configured — set the *_OAUTH_CLIENT_ID/SECRET env vars`,
    );
  }
  return { clientId, clientSecret };
}
