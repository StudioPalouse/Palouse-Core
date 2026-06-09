import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { loadEnv } from '@reqops/config';
import { getDb, webhookDeliveries } from '@reqops/db';
import { integrationService } from '@reqops/core';
import { enqueueWebhook } from '@reqops/queue';
import { getSyncQueue } from '../queue.js';
import { logger } from '../logger.js';

export const webhookRoutes = new Hono();

/**
 * Asana webhook receiver. Two phases:
 * 1. Handshake — Asana POSTs with X-Hook-Secret; we persist it (encrypted)
 *    and echo the header back.
 * 2. Events — X-Hook-Signature is HMAC-SHA256(body) with that secret. Valid,
 *    novel deliveries are recorded for idempotency and enqueued as a sync job.
 */
webhookRoutes.post('/asana/:integrationId', async (c) => {
  const env = loadEnv();
  const db = getDb(env.DATABASE_URL);
  const integrationId = c.req.param('integrationId');

  let integration;
  try {
    integration = await integrationService.getIntegrationRow(db, integrationId);
  } catch {
    return c.json({ error: 'unknown integration' }, 404);
  }

  const hookSecret = c.req.header('x-hook-secret');
  if (hookSecret) {
    await integrationService.setWebhookSecret(
      db,
      env.REQOPS_ENCRYPTION_KEY,
      integrationId,
      hookSecret,
    );
    logger.info({ integrationId }, 'Asana webhook handshake complete');
    c.header('X-Hook-Secret', hookSecret);
    return c.body(null, 200);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header('x-hook-signature');
  const secret = integrationService.decryptWebhookSecret(integration, env.REQOPS_ENCRYPTION_KEY);
  if (!signature || !secret) return c.json({ error: 'missing signature or handshake' }, 401);

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    logger.warn({ integrationId }, 'Asana webhook signature mismatch');
    return c.json({ error: 'bad signature' }, 401);
  }

  // Idempotency: (provider, payload hash) is unique — replays no-op.
  const payloadHash = createHash('sha256').update(rawBody).digest('hex');
  const inserted = await db
    .insert(webhookDeliveries)
    .values({ integrationId, provider: 'asana', signature, payloadHash })
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });

  const delivery = inserted[0];
  if (delivery) {
    await enqueueWebhook(getSyncQueue(), integrationId, delivery.id);
  }
  return c.json({ ok: true });
});
