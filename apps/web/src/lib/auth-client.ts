import { createAuthClient } from 'better-auth/react';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const authClient = createAuthClient({
  baseURL: API_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;
