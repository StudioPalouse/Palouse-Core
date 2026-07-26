import { describe, expect, it } from 'vitest';
import type { Database } from '@palouse/db';
import type { loadEnv } from '@palouse/config';
import { mcpAudience, mcpOAuthPlugins } from './mcp-oauth.js';

type Env = ReturnType<typeof loadEnv>;

// Minimal env: mcpOAuthPlugins only reads PUBLIC_MCP_URL / MCP_HTTP_PORT at
// construction (via mcpAudience). db is captured by async hooks but never
// touched while the plugin is built, so a cast stub is enough here.
function envWith(overrides: Partial<Env>): Env {
  return { MCP_HTTP_PORT: 8787, ...overrides } as Env;
}

const db = {} as Database;

/** A db whose only queried table is mcp_connect_selections. */
function dbWithSelection(selection: unknown): Database {
  return {
    query: { mcpConnectSelections: { findFirst: async () => selection } },
  } as unknown as Database;
}

type ConsentReferenceId = (info: {
  session?: { id: string; userId: string };
  scopes: string[];
}) => Promise<string | undefined>;

function consentReferenceIdFor(database: Database): ConsentReferenceId {
  const provider = mcpOAuthPlugins(envWith({}), database).find((p) => p.id === 'oauth-provider');
  expect(provider, 'oauth-provider plugin should be registered').toBeDefined();
  const hook = (provider as { options: { postLogin?: { consentReferenceId?: unknown } } }).options
    .postLogin?.consentReferenceId;
  expect(hook, 'postLogin.consentReferenceId should be configured').toBeTypeOf('function');
  return hook as ConsentReferenceId;
}

function validAudiencesFor(env: Env): unknown {
  const provider = mcpOAuthPlugins(env, db).find((p) => p.id === 'oauth-provider');
  expect(provider, 'oauth-provider plugin should be registered').toBeDefined();
  return (provider as { options: { validAudiences?: unknown } }).options.validAudiences;
}

// Regression guard for GHSA-p2fr-6hmx-4528 (unbound resource indicators in
// @better-auth/oauth-provider < 1.7.0-beta.4). We deliberately stay on 1.6.23
// and rely on the advisory's own documented workarounds: advertise exactly one
// audience here, and have the MCP resource server pin the same `aud`
// (apps/mcp/src/auth.ts). With a single valid audience there is no second
// resource for a token to be re-targeted at, so the vulnerability has no target.
// If anyone widens validAudiences to more than one entry, that mitigation is
// gone and this test must fail loudly. See docs/dependencies.md.
describe('mcpOAuthPlugins validAudiences (GHSA-p2fr-6hmx-4528 mitigation)', () => {
  it('advertises exactly one audience, equal to mcpAudience(env)', () => {
    const env = envWith({ PUBLIC_MCP_URL: 'https://mcp.palouse.ai/mcp' });
    const audiences = validAudiencesFor(env);
    expect(Array.isArray(audiences)).toBe(true);
    expect(audiences).toEqual([mcpAudience(env)]);
    expect((audiences as unknown[]).length).toBe(1);
  });

  it('falls back to the local MCP URL when PUBLIC_MCP_URL is unset', () => {
    const env = envWith({ PUBLIC_MCP_URL: undefined, MCP_HTTP_PORT: 9999 });
    expect(validAudiencesFor(env)).toEqual(['http://localhost:9999/mcp']);
  });
});

// The consent screen lets a user switch individual agent scopes off. The
// provider hands this hook the *granted* scopes, so "no agent scope" is
// ambiguous: it is either a plain OIDC sign-in or an MCP connect narrowed to
// nothing. Getting that wrong either breaks OIDC sign-in or mints a token with
// no palouse_agent_id, which apps/mcp rejects on every subsequent call.
describe('consentReferenceId', () => {
  const session = { id: 'sess_1', userId: 'user_1' };
  const fresh = {
    userId: 'user_1',
    agentId: 'agent_1',
    updatedAt: new Date(Date.now() - 30_000),
  };

  it('pins the selected agent when agent scopes are granted', async () => {
    const hook = consentReferenceIdFor(dbWithSelection(fresh));
    await expect(hook({ session, scopes: ['openid', 'tasks:read'] })).resolves.toBe('agent_1');
  });

  it('still pins the agent when the user narrows to a single scope', async () => {
    const hook = consentReferenceIdFor(dbWithSelection(fresh));
    await expect(hook({ session, scopes: ['tasks:read'] })).resolves.toBe('agent_1');
  });

  it('refuses an MCP connect narrowed until no agent scope is left', async () => {
    const hook = consentReferenceIdFor(dbWithSelection(fresh));
    await expect(hook({ session, scopes: ['openid', 'email'] })).rejects.toThrow(
      /at least one permission/i,
    );
  });

  it('leaves a plain OIDC sign-in alone when no workspace was ever selected', async () => {
    const hook = consentReferenceIdFor(dbWithSelection(undefined));
    await expect(hook({ session, scopes: ['openid', 'email'] })).resolves.toBeUndefined();
  });

  // Without the freshness check, an OIDC sign-in in a browser session that had
  // connected an MCP client earlier would be refused for no visible reason.
  it('leaves a plain OIDC sign-in alone when the selection has aged out', async () => {
    const stale = { ...fresh, updatedAt: new Date(Date.now() - 60 * 60_000) };
    const hook = consentReferenceIdFor(dbWithSelection(stale));
    await expect(hook({ session, scopes: ['openid', 'email'] })).resolves.toBeUndefined();
  });

  it('refuses an MCP connect whose selection belongs to another user', async () => {
    const hook = consentReferenceIdFor(dbWithSelection({ ...fresh, userId: 'user_2' }));
    await expect(hook({ session, scopes: ['tasks:read'] })).rejects.toThrow(
      /No workspace selected/i,
    );
  });
});
