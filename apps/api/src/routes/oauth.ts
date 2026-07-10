import { Hono } from 'hono';
import { createOAuthState, verifyOAuthState } from '@palouse/connector-core';
import { msAdminConsentUrl } from '@palouse/connector-microsoft-graph';
import { integrationService, workspaces } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb } from '@palouse/db';
import { integrationProvider, validation } from '@palouse/shared';
import { enqueuePull } from '@palouse/queue';
import { adapterFor, oauthConfigFor } from '../connectors.js';
import { getSyncQueue } from '../queue.js';
import { requireSession, type SessionVars } from '../middleware/session.js';
import { logger } from '../logger.js';

export const oauthRoutes = new Hono<SessionVars>();

function redirectUriFor(apiBaseUrl: string, provider: string): string {
  return `${apiBaseUrl}/oauth/${provider}/callback`;
}

const MS_PROVIDERS: ReadonlySet<string> = new Set(['ms_tasks', 'ms_todo', 'ms_planner']);

/**
 * Maps provider error params on the callback to the code the settings page
 * explains. Entra blocks the sign-in when the tenant requires admin approval
 * for new apps; surface that case so the UI can hand-hold instead of showing
 * a generic failure.
 */
function callbackErrorCode(error?: string, description?: string): string {
  const adminConsentNeeded =
    error === 'consent_required' ||
    error === 'admin_consent_required' ||
    /AADSTS(90094|65001)/.test(description ?? '');
  return adminConsentNeeded ? 'ms_admin_consent' : 'oauth_denied';
}

oauthRoutes.get('/:provider/start', requireSession, async (c) => {
  const env = loadEnv();
  const providerParsed = integrationProvider.safeParse(c.req.param('provider'));
  if (!providerParsed.success) throw validation('Unknown provider');
  const provider = providerParsed.data;
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');

  const db = getDb(env.DATABASE_URL);
  await workspaces.requireRole(db, workspaceId, c.get('userId'), ['owner', 'admin']);

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

/**
 * Redirects to Microsoft's tenant-wide admin-consent page. Session-less by
 * design: the link is meant to be copied and sent to an IT admin who has no
 * Palouse account, and it exposes only the public OAuth client id.
 */
oauthRoutes.get('/:provider/admin-consent', async (c) => {
  const env = loadEnv();
  const providerParsed = integrationProvider.safeParse(c.req.param('provider'));
  if (!providerParsed.success || !MS_PROVIDERS.has(providerParsed.data)) {
    throw validation('Admin consent links are only available for Microsoft connections');
  }
  const provider = providerParsed.data;
  const config = oauthConfigFor(env, provider);
  return c.redirect(
    msAdminConsentUrl({
      clientId: config.clientId,
      redirectUri: redirectUriFor(env.API_BASE_URL, provider),
    }),
  );
});

oauthRoutes.get('/:provider/callback', async (c) => {
  const env = loadEnv();
  const providerParsed = integrationProvider.safeParse(c.req.param('provider'));
  if (!providerParsed.success) throw validation('Unknown provider');
  const provider = providerParsed.data;
  const settingsUrl = `${env.WEB_BASE_URL}/settings/integrations`;

  // An IT admin returning from the tenant-wide admin-consent flow (no code).
  if (c.req.query('admin_consent') === 'True') {
    return c.redirect(`${settingsUrl}?admin_consent=granted`);
  }

  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return c.redirect(
      `${settingsUrl}?error=${callbackErrorCode(c.req.query('error'), c.req.query('error_description'))}`,
    );
  }

  const payload = verifyOAuthState(state, env.BETTER_AUTH_SECRET);
  if (!payload || payload.provider !== provider) {
    return c.redirect(`${settingsUrl}?error=bad_state`);
  }

  // The signed state outlives role changes for up to ten minutes; the user
  // must still be an active owner/admin before we exchange the code or
  // persist anything. Same generic error as any other failure so the
  // response does not reveal whether the workspace exists.
  const db = getDb(env.DATABASE_URL);
  try {
    await workspaces.requireRole(db, payload.workspaceId, payload.userId, ['owner', 'admin']);
  } catch {
    return c.redirect(`${settingsUrl}?error=oauth_failed`);
  }

  try {
    const adapter = adapterFor(provider);
    const tokens = await adapter.exchangeCode({
      config: oauthConfigFor(env, provider),
      redirectUri: redirectUriFor(env.API_BASE_URL, provider),
      code,
    });

    const integration = await integrationService.createIntegration(
      db,
      env.PALOUSE_ENCRYPTION_KEY,
      payload.workspaceId,
      provider,
      tokens,
    );

    // Webhook subscription is best-effort: it requires a publicly reachable
    // API_BASE_URL, which local dev usually doesn't have. Polling still works.
    if (adapter.subscribeWebhook) {
      try {
        // Arm first: the callback URL carries a random nonce and Graph gets a
        // random clientState; only their hashes are stored.
        const armed = await integrationService.armWebhook(db, integration.id);
        const sub = await adapter.subscribeWebhook(
          {
            integrationId: integration.id,
            workspaceId: payload.workspaceId,
            accessToken: tokens.accessToken,
          },
          `${env.API_BASE_URL}/webhooks/${provider}/${integration.id}/${armed.nonce}`,
          { clientState: armed.clientState },
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
          'Webhook subscription failed, falling back to polling',
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
