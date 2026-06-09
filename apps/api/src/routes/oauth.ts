import { Hono } from 'hono';
import { createOAuthState, verifyOAuthState } from '@reqops/connector-core';
import { integrationService, workspaces } from '@reqops/core';
import { loadEnv } from '@reqops/config';
import { getDb } from '@reqops/db';
import { integrationProvider, validation } from '@reqops/shared';
import { enqueuePull } from '@reqops/queue';
import { adapterFor, oauthConfigFor } from '../connectors.js';
import { getSyncQueue } from '../queue.js';
import { requireSession, type SessionVars } from '../middleware/session.js';
import { logger } from '../logger.js';

export const oauthRoutes = new Hono<SessionVars>();

function redirectUriFor(apiBaseUrl: string, provider: string): string {
  return `${apiBaseUrl}/oauth/${provider}/callback`;
}

oauthRoutes.get('/:provider/start', requireSession, async (c) => {
  const env = loadEnv();
  const providerParsed = integrationProvider.safeParse(c.req.param('provider'));
  if (!providerParsed.success) throw validation('Unknown provider');
  const provider = providerParsed.data;
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');

  const db = getDb(env.DATABASE_URL);
  await workspaces.requireMembership(db, workspaceId, c.get('userId'));

  const adapter = adapterFor(provider);
  const config = oauthConfigFor(env, provider);
  const state = createOAuthState(
    { workspaceId, userId: c.get('userId'), provider },
    env.BETTER_AUTH_SECRET,
  );
  return c.redirect(
    adapter.buildAuthUrl({ config, redirectUri: redirectUriFor(env.API_BASE_URL, provider), state }),
  );
});

oauthRoutes.get('/:provider/callback', async (c) => {
  const env = loadEnv();
  const providerParsed = integrationProvider.safeParse(c.req.param('provider'));
  if (!providerParsed.success) throw validation('Unknown provider');
  const provider = providerParsed.data;
  const settingsUrl = `${env.WEB_BASE_URL}/settings`;

  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.redirect(`${settingsUrl}?error=oauth_denied`);

  const payload = verifyOAuthState(state, env.BETTER_AUTH_SECRET);
  if (!payload || payload.provider !== provider) {
    return c.redirect(`${settingsUrl}?error=bad_state`);
  }

  try {
    const adapter = adapterFor(provider);
    const tokens = await adapter.exchangeCode({
      config: oauthConfigFor(env, provider),
      redirectUri: redirectUriFor(env.API_BASE_URL, provider),
      code,
    });

    const db = getDb(env.DATABASE_URL);
    const integration = await integrationService.createIntegration(
      db,
      env.REQOPS_ENCRYPTION_KEY,
      payload.workspaceId,
      provider,
      tokens,
    );

    // Webhook subscription is best-effort: it requires a publicly reachable
    // API_BASE_URL, which local dev usually doesn't have. Polling still works.
    if (adapter.subscribeWebhook) {
      try {
        const sub = await adapter.subscribeWebhook(
          {
            integrationId: integration.id,
            workspaceId: payload.workspaceId,
            accessToken: tokens.accessToken,
          },
          `${env.API_BASE_URL}/webhooks/${provider}/${integration.id}`,
        );
        await integrationService.setWebhookSubscription(
          db,
          integration.id,
          sub.subscriptionId,
          sub.expiresAt,
        );
      } catch (err) {
        logger.warn(
          { provider, integrationId: integration.id, err: (err as Error).message },
          'Webhook subscription failed — falling back to polling',
        );
      }
    }

    await enqueuePull(getSyncQueue(), integration.id);
    return c.redirect(`${settingsUrl}?connected=${provider}`);
  } catch (err) {
    logger.error({ provider, err }, 'OAuth callback failed');
    return c.redirect(`${settingsUrl}?error=oauth_failed`);
  }
});
