import { describe, expect, it } from 'vitest';
import { isEmailDomainBlocked, policyFromEnv } from './email-policy.js';

describe('policyFromEnv', () => {
  it('parses the extra blocklist case-insensitively and ignores blanks', () => {
    const policy = policyFromEnv({
      AUTH_BLOCK_PUBLIC_EMAIL_DOMAINS: false,
      AUTH_BLOCKED_EMAIL_DOMAINS: ' Example.com, , spam.io ,',
    });
    expect(policy.extraBlockedDomains).toEqual(new Set(['example.com', 'spam.io']));
  });
});

describe('isEmailDomainBlocked', () => {
  const off = policyFromEnv({ AUTH_BLOCK_PUBLIC_EMAIL_DOMAINS: false });
  const on = policyFromEnv({ AUTH_BLOCK_PUBLIC_EMAIL_DOMAINS: true });

  it('blocks nothing by default (self-hosted out of the box)', () => {
    expect(isEmailDomainBlocked('user@gmail.com', off)).toBe(false);
    expect(isEmailDomainBlocked('user@outlook.com', off)).toBe(false);
  });

  it('blocks public providers when the flag is on', () => {
    for (const domain of ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com', 'icloud.com']) {
      expect(isEmailDomainBlocked(`user@${domain}`, on)).toBe(true);
    }
  });

  it('still allows work domains when the flag is on', () => {
    expect(isEmailDomainBlocked('user@requisiteoperations.com', on)).toBe(false);
    expect(isEmailDomainBlocked('user@acme.dev', on)).toBe(false);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(isEmailDomainBlocked('  User@GMAIL.COM ', on)).toBe(true);
  });

  it('blocks extra domains even when the public flag is off', () => {
    const policy = policyFromEnv({
      AUTH_BLOCK_PUBLIC_EMAIL_DOMAINS: false,
      AUTH_BLOCKED_EMAIL_DOMAINS: 'competitor.com',
    });
    expect(isEmailDomainBlocked('spy@competitor.com', policy)).toBe(true);
    expect(isEmailDomainBlocked('user@gmail.com', policy)).toBe(false);
  });
});
