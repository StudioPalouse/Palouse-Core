/**
 * Signup email-domain policy.
 *
 * Two independent controls, both env-driven (see @reqops/config):
 * - AUTH_BLOCK_PUBLIC_EMAIL_DOMAINS: rejects the well-known public/free
 *   providers below. The hosted cloud turns this on; self-hosted deployments
 *   leave it off unless the admin opts in.
 * - AUTH_BLOCKED_EMAIL_DOMAINS: comma-separated custom domains, rejected
 *   regardless of the flag.
 */

export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  'gmail.com',
  'googlemail.com',
  // Microsoft
  'outlook.com',
  'outlook.co.uk',
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.fr',
  'live.com',
  'live.co.uk',
  'msn.com',
  // Yahoo
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.fr',
  'yahoo.de',
  'ymail.com',
  'rocketmail.com',
  // Apple
  'icloud.com',
  'me.com',
  'mac.com',
  // Proton
  'proton.me',
  'protonmail.com',
  'pm.me',
  // Other public providers
  'aol.com',
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'web.de',
  'mail.com',
  'zoho.com',
  'zohomail.com',
  'fastmail.com',
  'hey.com',
  'tutanota.com',
  'tuta.com',
  'tuta.io',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  'qq.com',
  '163.com',
  '126.com',
]);

export const BLOCKED_EMAIL_MESSAGE =
  'Sign-ups with personal email addresses are disabled here. Please use your work email address.';

export interface EmailSignupPolicy {
  blockPublicDomains: boolean;
  extraBlockedDomains: ReadonlySet<string>;
}

export function policyFromEnv(env: {
  AUTH_BLOCK_PUBLIC_EMAIL_DOMAINS: boolean;
  AUTH_BLOCKED_EMAIL_DOMAINS?: string | undefined;
}): EmailSignupPolicy {
  const extra = (env.AUTH_BLOCKED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return {
    blockPublicDomains: env.AUTH_BLOCK_PUBLIC_EMAIL_DOMAINS,
    extraBlockedDomains: new Set(extra),
  };
}

export function isEmailDomainBlocked(email: string, policy: EmailSignupPolicy): boolean {
  const domain = email.trim().toLowerCase().split('@').pop() ?? '';
  if (policy.extraBlockedDomains.has(domain)) return true;
  return policy.blockPublicDomains && PUBLIC_EMAIL_DOMAINS.has(domain);
}
