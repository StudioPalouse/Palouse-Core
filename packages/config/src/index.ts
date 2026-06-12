import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** Find the nearest .env walking up from cwd (monorepo root in dev). */
function findDotenv(): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),

  // Signup policy: 'true'/'1' rejects sign-ups from public email providers
  // (gmail.com, outlook.com, …). On for the hosted cloud; off by default so
  // self-hosted admins opt in deliberately.
  AUTH_BLOCK_PUBLIC_EMAIL_DOMAINS: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  // Comma-separated extra domains to reject, applied even when the flag above is off.
  AUTH_BLOCKED_EMAIL_DOMAINS: z.string().optional(),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_URL: z.string().url(),
  WEB_BASE_URL: z.string().url(),

  REQOPS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'must be 64 hex chars (AES-256 key)'),

  MCP_HTTP_PORT: z.coerce.number().int().positive().default(7777),
  REQOPS_API_URL: z.string().url().optional(),

  // Transactional mail (Resend). Unset = mail is a logged no-op, so
  // self-hosted deployments work without a mail provider.
  RESEND_API_KEY: z.string().optional(),
  // Must use a domain verified in the Resend dashboard for real delivery;
  // the onboarding default only delivers to the Resend account owner.
  MAIL_FROM: z.string().default('ReqOps <onboarding@resend.dev>'),

  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_OAUTH_CLIENT_ID: z.string().optional(),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().optional(),
  ASANA_OAUTH_CLIENT_ID: z.string().optional(),
  ASANA_OAUTH_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  if (source === process.env) {
    const dotenvPath = findDotenv();
    // Real environment variables win over .env file values. quiet: dotenv v17
    // logs a tip to stdout, which would corrupt MCP's stdio transport.
    if (dotenvPath) loadDotenv({ path: dotenvPath, quiet: true });
  }
  const result = envSchema.safeParse(source);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    throw new Error('Invalid environment — see errors above');
  }
  cached = result.data;
  return cached;
}

/** For tests — clears the memoized env so the next `loadEnv` re-reads. */
export function _resetEnvForTest(): void {
  cached = undefined;
}
