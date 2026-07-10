import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimits } from './middleware/body-limits.js';
import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from '@better-auth/oauth-provider';
import { PalouseError } from '@palouse/shared';
import { getAuth } from '@palouse/auth';
import { loadEnv } from '@palouse/config';
import { agentRoutes } from './routes/agents.js';
import { decisionRoutes } from './routes/decisions.js';
import { objectiveRoutes } from './routes/objectives.js';
import { projectRoutes } from './routes/projects.js';
import { handoffRoutes } from './routes/handoffs.js';
import { health } from './routes/health.js';
import { integrationRoutes } from './routes/integrations.js';
import { invitationRoutes } from './routes/invitations.js';
import { mcpConnectRoutes } from './routes/mcp-connect.js';
import { oauthRoutes } from './routes/oauth.js';
import { otlpRoutes } from './routes/otlp.js';
import { taskRoutes } from './routes/tasks.js';
import { usageRoutes } from './routes/usage.js';
import { webhookRoutes } from './routes/webhooks.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { logger } from './logger.js';

export function buildApp() {
  const env = loadEnv();
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: [env.WEB_BASE_URL],
      credentials: true,
    }),
  );

  // Reject oversized bodies before any handler reads them.
  app.use('*', bodyLimits());

  app.onError((err, c) => {
    if (err instanceof PalouseError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    }
    logger.error({ err }, 'Unhandled error');
    return c.json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, 500);
  });

  app.route('/health', health);

  // Better-Auth mounts /api/auth/* — see https://better-auth.com/docs
  const auth = getAuth();
  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  // OAuth 2.1 discovery for MCP clients (docs/PLAN-mcp-oauth.md). RFC 8414
  // requires these at the origin root, outside /api/auth; the web app proxies
  // them through so they resolve on the public origin. Both the plain path and
  // the path-insert variant (issuer has the /api/auth path component) are
  // served, since clients construct either form.
  const authServerMeta = oauthProviderAuthServerMetadata(auth);
  const openIdMeta = oauthProviderOpenIdConfigMetadata(auth);
  for (const suffix of ['', '/api/auth']) {
    app.get(`/.well-known/oauth-authorization-server${suffix}`, (c) =>
      authServerMeta(c.req.raw),
    );
    app.get(`/.well-known/openid-configuration${suffix}`, (c) => openIdMeta(c.req.raw));
  }

  app.get('/v1', (c) => c.json({ name: 'palouse', version: '0.0.0' }));
  app.route('/v1/workspaces', workspaceRoutes);
  app.route('/v1/tasks', taskRoutes);
  app.route('/v1/decisions', decisionRoutes);
  app.route('/v1/objectives', objectiveRoutes);
  app.route('/v1/projects', projectRoutes);
  app.route('/v1/agents', agentRoutes);
  app.route('/v1', handoffRoutes); // /v1/tasks/:id/handoff + /v1/handoffs/*
  app.route('/v1', usageRoutes); // /v1/usage/* + /v1/model-prices*
  app.route('/v1/otlp', otlpRoutes); // agent-key auth; full path /v1/otlp/v1/traces
  app.route('/v1/integrations', integrationRoutes);
  app.route('/v1/invitations', invitationRoutes);
  app.route('/v1/mcp-connect', mcpConnectRoutes);
  app.route('/oauth', oauthRoutes);
  app.route('/webhooks', webhookRoutes);

  return app;
}
