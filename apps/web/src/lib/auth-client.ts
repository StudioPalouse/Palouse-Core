import { createAuthClient } from 'better-auth/react';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';

// Same-origin by default: API calls ride the Next rewrite proxy (next.config.mjs),
// so auth cookies stay first-party. Set NEXT_PUBLIC_API_URL only to point the
// browser at an API origin directly.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export const authClient = createAuthClient({
  baseURL: API_URL,
  // Forwards the signed OAuth authorization query (oauth_query) on auth
  // requests made from the MCP connect pages, so sign-in resumes the
  // /oauth2/authorize flow server-side (docs/PLAN-mcp-oauth.md).
  plugins: [oauthProviderClient()],
});

export const { signIn, signUp, signOut, useSession, updateUser, changePassword } = authClient;
