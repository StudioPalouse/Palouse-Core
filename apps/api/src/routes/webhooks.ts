import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { loadEnv } from '@palouse/config';
import { getDb, webhookDeliveries, type Database } from '@palouse/db';
import { integrationService } from '@palouse/core';
import { enqueueWebhook } from '@palouse/queue';
import { getSyncQueue } from '../queue.js';
import { logger } from '../logger.js';

export const webhookRoutes = new Hono();

type IntegrationRow = integrationService.IntegrationRow;

function tokensMatch(presented: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(integrationService.hashWebhookToken(presented));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Resolves an integration for a nonced callback URL. Unknown ids and bad
 * nonces are indistinguishable (both 404) so the route leaks nothing about
 * which integration ids exist.
 */
async function integrationForNonce(
  db: Database,
  integrationId: string,
  nonce: string,
): Promise<IntegrationRow | undefined> {
  let row: IntegrationRow;
  try {
    row = await integrationService.getIntegrationRow(db, integrationId);
  } catch {
    return undefined;
  }
  return tokensMatch(nonce, row.webhookNonceHash) ? row : undefined;
}

/**
 * Resolves an integration for a legacy (nonce-less) callback URL. Only rows
 * created before nonced routes qualify; once the renewal sweep rotates a
 * subscription onto a nonced URL its legacy path stops matching.
 */
async function integrationForLegacyRoute(
  db: Database,
  integrationId: string,
): Promise<IntegrationRow | undefined> {
  let row: IntegrationRow;
  try {
    row = await integrationService.getIntegrationRow(db, integrationId);
  } catch {
    return undefined;
  }
  return row.webhookNonceHash === null ? row : undefined;
}

/** Records a delivery for idempotency and enqueues at most one sync job. */
async function recordAndEnqueue(
  db: Database,
  integrationId: string,
  provider: 'asana' | 'ms_tasks' | 'ms_todo',
  signature: string,
  rawBody: string,
): Promise<void> {
  const payloadHash = createHash('sha256').update(rawBody).digest('hex');
  const inserted = await db
    .insert(webhookDeliveries)
    .values({ integrationId, provider, signature, payloadHash })
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });
  const delivery = inserted[0];
  if (delivery) {
    await enqueueWebhook(getSyncQueue(), integrationId, delivery.id);
  }
}

function verifyAsanaSignature(
  integration: IntegrationRow,
  encryptionKey: string,
  rawBody: string,
  signature: string | undefined,
): boolean {
  const secret = integrationService.decryptWebhookSecret(integration, encryptionKey);
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Asana webhook receiver (nonced route). Two phases:
 * 1. Handshake — Asana POSTs with X-Hook-Secret while the integration is
 *    armed ('pending' inside its window); we persist the secret (encrypted)
 *    and echo the header back. Outside that window the handshake is refused,
 *    so an unsolicited or replayed handshake can never replace the secret.
 * 2. Events — X-Hook-Signature is HMAC-SHA256(body) with that secret. Valid,
 *    novel deliveries are recorded for idempotency and enqueued as a sync job.
 */
webhookRoutes.post('/asana/:integrationId/:nonce', async (c) => {
  const env = loadEnv();
  const db = getDb(env.DATABASE_URL);
  const integrationId = c.req.param('integrationId');

  const integration = await integrationForNonce(db, integrationId, c.req.param('nonce'));
  if (!integration) {
    logger.warn({ integrationId }, 'Webhook rejected: unknown integration or bad nonce');
    return c.json({ error: 'unknown integration' }, 404);
  }

  const hookSecret = c.req.header('x-hook-secret');
  if (hookSecret) {
    try {
      await integrationService.setWebhookSecret(
        db,
        env.PALOUSE_ENCRYPTION_KEY,
        integrationId,
        hookSecret,
      );
    } catch {
      logger.warn({ integrationId }, 'Asana handshake refused: integration not armed');
      return c.json({ error: 'not awaiting handshake' }, 409);
    }
    logger.info({ integrationId }, 'Asana webhook handshake complete');
    c.header('X-Hook-Secret', hookSecret);
    return c.body(null, 200);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header('x-hook-signature');
  if (!verifyAsanaSignature(integration, env.PALOUSE_ENCRYPTION_KEY, rawBody, signature)) {
    logger.warn({ integrationId }, 'Asana webhook signature mismatch');
    return c.json({ error: 'bad signature' }, 401);
  }

  await recordAndEnqueue(db, integrationId, 'asana', signature!, rawBody);
  return c.json({ ok: true });
});

/**
 * Legacy Asana route for subscriptions registered before nonced URLs.
 * Events still verify against the stored secret; handshakes are refused
 * outright (an established subscription never legitimately re-handshakes
 * without us re-arming it, and re-arms always use the nonced route).
 */
webhookRoutes.post('/asana/:integrationId', async (c) => {
  const env = loadEnv();
  const db = getDb(env.DATABASE_URL);
  const integrationId = c.req.param('integrationId');

  const integration = await integrationForLegacyRoute(db, integrationId);
  if (!integration) return c.json({ error: 'unknown integration' }, 404);

  if (c.req.header('x-hook-secret')) {
    logger.warn({ integrationId }, 'Asana handshake refused on legacy route');
    return c.json({ error: 'not awaiting handshake' }, 409);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header('x-hook-signature');
  if (!verifyAsanaSignature(integration, env.PALOUSE_ENCRYPTION_KEY, rawBody, signature)) {
    logger.warn({ integrationId }, 'Asana webhook signature mismatch');
    return c.json({ error: 'bad signature' }, 401);
  }

  await recordAndEnqueue(db, integrationId, 'asana', signature!, rawBody);
  return c.json({ ok: true });
});

interface GraphNotification {
  clientState?: string;
  subscriptionId?: string;
}

function parseGraphNotifications(rawBody: string): GraphNotification[] | undefined {
  try {
    const parsed = JSON.parse(rawBody) as { value?: GraphNotification[] };
    return parsed.value ?? [];
  } catch {
    return undefined;
  }
}

/**
 * Microsoft Graph change-notification receiver (nonced route; ms_tasks plus
 * legacy ms_todo connections). Two phases:
 * 1. Validation — Graph POSTs ?validationToken=... on subscription create and
 *    expects the raw token echoed back as text/plain within 10 seconds.
 * 2. Notifications — JSON body { value: [...] }. Every notification must
 *    carry the random clientState minted at arm time (compared by hash,
 *    constant-time) and the exact subscription id we registered. Graph
 *    requires a 202 fast; processing happens on the sync queue.
 */
webhookRoutes.post('/:provider{ms_tasks|ms_todo}/:integrationId/:nonce', async (c) => {
  const provider = c.req.param('provider') as 'ms_tasks' | 'ms_todo';
  const validationToken = c.req.query('validationToken');
  if (validationToken) {
    return c.text(validationToken, 200);
  }

  const env = loadEnv();
  const db = getDb(env.DATABASE_URL);
  const integrationId = c.req.param('integrationId');

  const integration = await integrationForNonce(db, integrationId, c.req.param('nonce'));
  if (!integration) {
    logger.warn({ integrationId, provider }, 'Webhook rejected: unknown integration or bad nonce');
    return c.json({ error: 'unknown integration' }, 404);
  }

  const rawBody = await c.req.text();
  const notifications = parseGraphNotifications(rawBody);
  if (!notifications) return c.json({ error: 'bad payload' }, 400);

  const authentic =
    notifications.length > 0 &&
    notifications.every(
      (n) =>
        typeof n.clientState === 'string' &&
        tokensMatch(n.clientState, integration.webhookClientStateHash) &&
        n.subscriptionId === integration.webhookSubscriptionId,
    );
  if (!authentic) {
    logger.warn({ integrationId, provider }, 'Graph notification clientState mismatch');
    return c.json({ error: 'bad clientState' }, 401);
  }

  await recordAndEnqueue(db, integrationId, provider, integrationId, rawBody);
  return c.body(null, 202);
});

/**
 * Legacy Graph route for subscriptions registered before nonced URLs. Those
 * subscriptions carry clientState = integration id, so during the transition
 * window the subscription id must also match, raising the forgery bar from
 * "knows an integration id" to "knows the Graph subscription id". The renewal
 * sweep force-rotates these onto nonced URLs within one expiry cycle.
 */
webhookRoutes.post('/:provider{ms_tasks|ms_todo}/:integrationId', async (c) => {
  const provider = c.req.param('provider') as 'ms_tasks' | 'ms_todo';
  const validationToken = c.req.query('validationToken');
  if (validationToken) {
    return c.text(validationToken, 200);
  }

  const env = loadEnv();
  const db = getDb(env.DATABASE_URL);
  const integrationId = c.req.param('integrationId');

  const integration = await integrationForLegacyRoute(db, integrationId);
  if (!integration) return c.json({ error: 'unknown integration' }, 404);

  const rawBody = await c.req.text();
  const notifications = parseGraphNotifications(rawBody);
  if (!notifications) return c.json({ error: 'bad payload' }, 400);

  const authentic =
    notifications.length > 0 &&
    notifications.every(
      (n) =>
        n.clientState === integrationId && n.subscriptionId === integration.webhookSubscriptionId,
    );
  if (!authentic) {
    logger.warn({ integrationId, provider }, 'Graph notification clientState mismatch (legacy)');
    return c.json({ error: 'bad clientState' }, 401);
  }

  await recordAndEnqueue(db, integrationId, provider, integrationId, rawBody);
  return c.body(null, 202);
});
