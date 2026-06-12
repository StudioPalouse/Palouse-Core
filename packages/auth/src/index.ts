import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { loadEnv } from '@reqops/config';
import { getDb } from '@reqops/db';
import { BLOCKED_EMAIL_MESSAGE, isEmailDomainBlocked, policyFromEnv } from './email-policy.js';

function build() {
  const env = loadEnv();
  const db = getDb(env.DATABASE_URL);
  const emailPolicy = policyFromEnv(env);

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
    database: drizzleAdapter(db, { provider: 'pg', usePlural: true }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.WEB_BASE_URL],
    // Tables use uuid PKs with gen_random_uuid() defaults — let Postgres mint ids.
    advanced: { database: { generateId: false } },
    emailAndPassword: { enabled: true },
    socialProviders,
    databaseHooks: {
      user: {
        create: {
          // Runs for every signup path (password and social), before the row is written.
          before: async (user) => {
            if (isEmailDomainBlocked(user.email, emailPolicy)) {
              throw new APIError('BAD_REQUEST', { message: BLOCKED_EMAIL_MESSAGE });
            }
            return { data: user };
          },
        },
      },
    },
  });
}

export * from './email-policy.js';

export type AuthInstance = ReturnType<typeof build>;

let cached: AuthInstance | undefined;

export function getAuth(): AuthInstance {
  if (!cached) cached = build();
  return cached;
}
