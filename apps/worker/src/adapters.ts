import type { ConnectorAdapter, OAuthClientConfig } from '@reqops/connector-core';
import { googleTasksAdapter } from '@reqops/connector-google-tasks';
import { asanaAdapter } from '@reqops/connector-asana';
import type { Env } from '@reqops/config';
import type { IntegrationProvider } from '@reqops/shared';

const ADAPTERS: Partial<Record<IntegrationProvider, ConnectorAdapter>> = {
  google_tasks: googleTasksAdapter,
  asana: asanaAdapter,
  // ms_todo / ms_planner land in M4
};

export function adapterFor(provider: IntegrationProvider): ConnectorAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`No connector adapter for provider: ${provider}`);
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
    throw new Error(`OAuth client not configured for ${provider} — set the env vars in .env`);
  }
  return { clientId, clientSecret };
}

/** Poll cadence per provider (ms). Google Tasks has no webhooks; Asana polling is a fallback. */
export const POLL_INTERVAL_MS: Partial<Record<IntegrationProvider, number>> = {
  google_tasks: 60_000,
  asana: 300_000,
};
