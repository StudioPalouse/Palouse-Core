import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const statePayload = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  provider: z.string(),
  exp: z.number().int(),
});
export type OAuthStatePayload = z.infer<typeof statePayload>;

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Stateless CSRF-safe OAuth state: base64url(payload).hmac */
export function createOAuthState(
  payload: Omit<OAuthStatePayload, 'exp'>,
  secret: string,
  ttlMs = 10 * 60 * 1000,
): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + ttlMs }),
    'utf8',
  ).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function verifyOAuthState(state: string, secret: string): OAuthStatePayload | null {
  const dot = state.lastIndexOf('.');
  if (dot < 0) return null;
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = statePayload.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
    if (parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
