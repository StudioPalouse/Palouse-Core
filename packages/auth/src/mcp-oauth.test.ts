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
