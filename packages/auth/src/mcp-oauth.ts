import { jwt } from 'better-auth/plugins';
import { oauthProvider } from '@better-auth/oauth-provider';
import { APIError } from 'better-auth/api';
import { agentService } from '@palouse/core';
import { ALL_AGENT_KEY_SCOPES } from '@palouse/shared';
import type { Database } from '@palouse/db';
import type { loadEnv } from '@palouse/config';

type Env = ReturnType<typeof loadEnv>;

// Standard OIDC scopes kept alongside the agent scopes so generic OAuth
// clients keep working; MCP clients only ever ask for the agent scopes below
// (that is what the protected-resource metadata advertises) plus
// offline_access for refresh tokens.
const OIDC_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;

const AGENT_SCOPES = new Set<string>(ALL_AGENT_KEY_SCOPES);

// How long a stored workspace selection satisfies the post-login step. Long
// enough to cover the selection -> consent hop, short enough that the next
// connect flow asks again.
const SELECTION_TTL_MS = 10 * 60_000;

function isMcpConnect(scopes: readonly string[]): boolean {
  return scopes.some((s) => AGENT_SCOPES.has(s));
}

/** Audience MCP access tokens are minted for; must match what apps/mcp pins. */
export function mcpAudience(env: Env): string {
  return env.PUBLIC_MCP_URL ?? `http://localhost:${env.MCP_HTTP_PORT}/mcp`;
}

/**
 * OAuth 2.1 authorization server for the hosted MCP endpoint: MCP clients
 * discover this server from mcp.palouse.ai, register via RFC 7591, and send
 * the user through sign-in, workspace selection, and consent in the web app.
 *
 * Workspace selection rides the plugin's postLogin hook: the
 * /mcp-connect/workspace page stores the chosen workspace's agent in
 * mcp_connect_selections keyed by session, and consentReferenceId pins that
 * agent id to the consent. Every consent is therefore per (client, user,
 * agent), and customAccessTokenClaims stamps the agent + workspace into each
 * access token, so the MCP server resolves tenancy from the JWT alone.
 */
export function mcpOAuthPlugins(env: Env, db: Database) {
  return [
    // The drizzle adapter runs with usePlural and appends "s" to model names;
    // "jwk" resolves to our jwks table (the plugin default "jwks" would look
    // for "jwkss").
    jwt({ schema: { jwks: { modelName: 'jwk' } } }),
    oauthProvider({
      loginPage: '/sign-in',
      consentPage: '/mcp-connect/consent',
      scopes: [...OIDC_SCOPES, ...ALL_AGENT_KEY_SCOPES],
      // MCP clients (Claude, ChatGPT, Cursor) self-register on first connect.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      validAudiences: [mcpAudience(env)],
      postLogin: {
        page: '/mcp-connect/workspace',
        // Only MCP connections pick a workspace; plain OIDC sign-ins skip it.
        // The plugin's contract: return true to send the user to the page,
        // false once the step is satisfied (it is consulted again when the
        // page calls /oauth2/continue). A fresh selection satisfies it; the
        // TTL makes a later connect in the same browser session re-ask
        // instead of silently reusing the previous workspace.
        shouldRedirect: async ({ session, scopes }) => {
          if (!isMcpConnect(scopes)) return false;
          const selection = await db.query.mcpConnectSelections.findFirst({
            where: (t, { eq }) => eq(t.sessionId, session.id as string),
          });
          if (!selection || selection.userId !== session.userId) return true;
          return Date.now() - selection.updatedAt.getTime() > SELECTION_TTL_MS;
        },
        consentReferenceId: async ({ session, scopes }) => {
          if (!isMcpConnect(scopes)) return undefined;
          const selection = await db.query.mcpConnectSelections.findFirst({
            where: (t, { eq }) => eq(t.sessionId, session.id as string),
          });
          if (!selection || selection.userId !== session.userId) {
            throw new APIError('BAD_REQUEST', {
              message: 'No workspace selected for this connection. Restart the connect flow.',
            });
          }
          return selection.agentId;
        },
      },
      // Runs on both the authorization-code and refresh-token grants, so this
      // is where a revoked delegation stops minting new tokens. The grant is
      // the consenting user's authority: an archived agent, a deactivated
      // membership, or a removed member all refuse the mint.
      customAccessTokenClaims: async ({ user, referenceId }) => {
        if (!referenceId) return {};
        const revoked = new APIError('FORBIDDEN', {
          message: 'This connection was revoked. Reconnect to continue.',
        });
        if (!user?.id) throw revoked;
        try {
          const grant = await agentService.assertMcpGrant(db, {
            userId: user.id,
            agentId: referenceId,
          });
          return {
            palouse_agent_id: grant.agentId,
            palouse_workspace_id: grant.workspaceId,
            palouse_user_id: user.id,
          };
        } catch {
          throw revoked;
        }
      },
    }),
  ];
}
