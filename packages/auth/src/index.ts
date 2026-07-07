import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { loadEnv } from '@palouse/config';
import { getDb } from '@palouse/db';
import { renderBasicEmail, sendEmail } from '@palouse/mail';
import { BLOCKED_EMAIL_MESSAGE, isEmailDomainBlocked, policyFromEnv } from './email-policy.js';
import { mcpOAuthPlugins } from './mcp-oauth.js';

function build() {
  const env = loadEnv();
  const db = getDb(env.DATABASE_URL);
  const emailPolicy = policyFromEnv(env);
  // Require email verification only where transactional mail is configured.
  // On bare self-hosted installs without RESEND_API_KEY the verification email
  // can never send, so requiring it would lock users out — keep it off there.
  const mailConfigured = Boolean(env.RESEND_API_KEY);

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
    // The jwt plugin's session-JWT endpoint is unused; only the OAuth token
    // endpoint should mint JWTs (recommended by the oauth-provider docs).
    disabledPaths: ['/token'],
    plugins: mcpOAuthPlugins(env, db),
    emailAndPassword: {
      enabled: true,
      // Hosted policy: block sign-in until the email is verified. An unverified
      // sign-in attempt is rejected and Better-Auth re-sends the verification
      // link. Gated on mailConfigured so bare self-host installs still work.
      requireEmailVerification: mailConfigured,
      // Mail is best-effort: with no RESEND_API_KEY @palouse/mail logs and
      // no-ops, so password auth keeps working on bare self-hosted installs.
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: 'Reset your Palouse password',
          html: renderBasicEmail({
            heading: 'Reset your password',
            bodyLines: [
              'Someone (hopefully you) asked to reset the password for this Palouse account.',
              'If you didn’t ask, you can ignore this email.',
            ],
            ctaLabel: 'Reset password',
            ctaUrl: url,
          }),
        });
      },
    },
    emailVerification: {
      // Verification email goes out on signup; when mail is configured it is
      // also required to sign in (see emailAndPassword.requireEmailVerification).
      sendOnSignUp: true,
      // Re-send the link when an unverified user tries to sign in, so a blocked
      // sign-in always puts a fresh link in their inbox.
      sendOnSignIn: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: 'Verify your Palouse email',
          html: renderBasicEmail({
            heading: 'Verify your email',
            bodyLines: [`Confirm that ${user.email} belongs to you to finish setting up Palouse.`],
            ctaLabel: 'Verify email',
            ctaUrl: url,
          }),
        });
      },
    },
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
