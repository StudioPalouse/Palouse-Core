import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { loadEnv } from '@reqops/config';
import { getDb } from '@reqops/db';

function build() {
  const env = loadEnv();
  const db = getDb(env.DATABASE_URL);

  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (process.env.AUTH_GOOGLE_CLIENT_ID && process.env.AUTH_GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: process.env.AUTH_GOOGLE_CLIENT_ID,
      clientSecret: process.env.AUTH_GOOGLE_CLIENT_SECRET,
    };
  }
  if (process.env.AUTH_GITHUB_CLIENT_ID && process.env.AUTH_GITHUB_CLIENT_SECRET) {
    socialProviders.github = {
      clientId: process.env.AUTH_GITHUB_CLIENT_ID,
      clientSecret: process.env.AUTH_GITHUB_CLIENT_SECRET,
    };
  }
  if (process.env.AUTH_MICROSOFT_CLIENT_ID && process.env.AUTH_MICROSOFT_CLIENT_SECRET) {
    socialProviders.microsoft = {
      clientId: process.env.AUTH_MICROSOFT_CLIENT_ID,
      clientSecret: process.env.AUTH_MICROSOFT_CLIENT_SECRET,
    };
  }

  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg' }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true },
    socialProviders,
  });
}

export type AuthInstance = ReturnType<typeof build>;

let cached: AuthInstance | undefined;

export function getAuth(): AuthInstance {
  if (!cached) cached = build();
  return cached;
}
