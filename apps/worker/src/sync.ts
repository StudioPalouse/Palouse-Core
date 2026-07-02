import { and, eq, isNotNull, ne } from 'drizzle-orm';
import type { Logger } from 'pino';
import { integrations, taskSources, tasks, webhookDeliveries, type Database } from '@palouse/db';
import type { Env } from '@palouse/config';
import { integrationService, upsertExternalTask } from '@palouse/core';
import type { PullContext } from '@palouse/connector-core';
import { adapterFor, oauthConfigFor } from './adapters.js';

const CURSOR_RESOURCE = 'tasks';
const TOKEN_REFRESH_SLACK_MS = 60_000;

/** Decrypts the access token, refreshing it first when it's about to expire. */
async function freshAccessToken(
  db: Database,
  env: Env,
  row: integrationService.IntegrationRow,
): Promise<string> {
  const expiresSoon =
    row.oauthExpiresAt != null && row.oauthExpiresAt.getTime() < Date.now() + TOKEN_REFRESH_SLACK_MS;
  if (!expiresSoon) return integrationService.decryptAccessToken(row, env.PALOUSE_ENCRYPTION_KEY);

  const adapter = adapterFor(row.provider);
  const refreshToken = integrationService.decryptRefreshToken(row, env.PALOUSE_ENCRYPTION_KEY);
  if (!adapter.refreshTokens || !refreshToken) {
    // No refresh path — use what we have and let the provider reject it if stale.
    return integrationService.decryptAccessToken(row, env.PALOUSE_ENCRYPTION_KEY);
  }
  const refreshed = await adapter.refreshTokens({
    config: oauthConfigFor(env, row.provider),
    refreshToken,
  });
  await integrationService.saveRefreshedTokens(db, env.PALOUSE_ENCRYPTION_KEY, row.id, refreshed);
  return refreshed.accessToken;
}

export async function runPull(
  db: Database,
  env: Env,
  logger: Logger,
  integrationId: string,
): Promise<void> {
  const row = await integrationService.getIntegrationRow(db, integrationId);
  if (row.status === 'revoked') {
    logger.info({ integrationId }, 'Skipping pull for revoked integration');
    return;
  }
  const adapter = adapterFor(row.provider);

  try {
    const ctx: PullContext = {
      integrationId,
      workspaceId: row.workspaceId,
      accessToken: await freshAccessToken(db, env, row),
      cursor: await integrationService.getSyncCursor(db, integrationId, CURSOR_RESOURCE),
      // Per-connection config (Notion uses it for dataSourceId + field map).
      config: row.config,
    };
    const result = await adapter.pull(ctx);

    let created = 0;
    for (const ext of result.tasks) {
      const r = await upsertExternalTask(db, row.workspaceId, integrationId, ext);
      if (r.created) created++;
    }
    if (result.nextCursor) {
      await integrationService.saveSyncCursor(db, integrationId, CURSOR_RESOURCE, result.nextCursor);
    }
    await integrationService.markSyncResult(db, integrationId, { ok: true });
    logger.info(
      { integrationId, provider: row.provider, pulled: result.tasks.length, created },
      'Pull complete',
    );
  } catch (err) {
    await integrationService.markSyncResult(db, integrationId, { ok: false });
    throw err;
  }
}

export async function runProcessWebhook(
  db: Database,
  env: Env,
  logger: Logger,
  integrationId: string,
  deliveryId: string,
): Promise<void> {
  // v1 treats webhook events as a sync trigger — the incremental pull picks up
  // whatever changed, which keeps processing idempotent.
  await runPull(db, env, logger, integrationId);
  await db
    .update(webhookDeliveries)
    .set({ processedAt: new Date(), status: 'processed' })
    .where(eq(webhookDeliveries.id, deliveryId));
}

/** Pushes Palouse-side task changes back to every linked external system. */
export async function runPush(
  db: Database,
  env: Env,
  logger: Logger,
  taskId: string,
): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) {
    logger.warn({ taskId }, 'Push skipped — task no longer exists');
    return;
  }
  const sources = await db.select().from(taskSources).where(eq(taskSources.taskId, taskId));

  for (const source of sources) {
    const row = await integrationService.getIntegrationRow(db, source.integrationId);
    if (row.status === 'revoked') continue;
    const adapter = adapterFor(row.provider);
    if (!adapter.push) continue;

    const ctx: PullContext = {
      integrationId: row.id,
      workspaceId: row.workspaceId,
      accessToken: await freshAccessToken(db, env, row),
    };
    await adapter.push(ctx, {
      externalId: source.externalId,
      externalSystem: source.externalSystem,
      title: task.title,
      status: task.status,
      descriptionMd: task.descriptionMd,
      dueAt: task.dueAt?.toISOString() ?? null,
    });
    logger.info(
      { taskId, integrationId: row.id, provider: row.provider },
      'Pushed task to external system',
    );
  }
}

// Renew when a subscription is within this window of lapsing (MS Graph caps
// To Do subscriptions at ~3 days; the sweep runs every 6 hours).
const RENEW_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Sweeps integrations with webhook subscriptions and renews any near expiry. */
export async function runRenewSubscriptions(
  db: Database,
  env: Env,
  logger: Logger,
): Promise<void> {
  const rows = await db
    .select()
    .from(integrations)
    .where(and(isNotNull(integrations.webhookSubscriptionId), ne(integrations.status, 'revoked')));

  for (const row of rows) {
    const adapter = adapterFor(row.provider);
    if (!adapter.renewWebhook || !row.webhookSubscriptionId) continue;
    if (
      row.webhookExpiresAt &&
      row.webhookExpiresAt.getTime() > Date.now() + RENEW_WINDOW_MS
    ) {
      continue;
    }

    const ctx: PullContext = {
      integrationId: row.id,
      workspaceId: row.workspaceId,
      accessToken: await freshAccessToken(db, env, row),
    };
    try {
      const sub = await adapter.renewWebhook(ctx, row.webhookSubscriptionId);
      await integrationService.setWebhookSubscription(db, row.id, sub.subscriptionId, sub.expiresAt);
      logger.info(
        { integrationId: row.id, provider: row.provider, expiresAt: sub.expiresAt },
        'Webhook subscription renewed',
      );
    } catch (err) {
      // Lapsed subscriptions cannot be renewed — fall back to creating a new one.
      logger.warn(
        { integrationId: row.id, provider: row.provider, err: (err as Error).message },
        'Renewal failed — attempting fresh subscription',
      );
      try {
        if (!adapter.subscribeWebhook) continue;
        const sub = await adapter.subscribeWebhook(
          ctx,
          `${env.API_BASE_URL}/webhooks/${row.provider}/${row.id}`,
        );
        await integrationService.setWebhookSubscription(db, row.id, sub.subscriptionId, sub.expiresAt);
        logger.info({ integrationId: row.id }, 'Webhook re-subscribed');
      } catch (err2) {
        logger.error(
          { integrationId: row.id, err: (err2 as Error).message },
          'Webhook re-subscription failed — polling remains the fallback',
        );
      }
    }
  }
}
