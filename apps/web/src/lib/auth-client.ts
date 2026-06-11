import { createAuthClient } from 'better-auth/react';

// Same-origin by default: API calls ride the Next rewrite proxy (next.config.mjs),
// so auth cookies stay first-party. Set NEXT_PUBLIC_API_URL only to point the
// browser at an API origin directly.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export const authClient = createAuthClient({
  baseURL: API_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;
