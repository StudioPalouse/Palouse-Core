import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { taskSources, tasks, webhookDeliveries, type Database } from '@reqops/db';
import type { Env } from '@reqops/config';
import { integrationService, upsertExternalTask } from '@reqops/core';
import type { PullContext } from '@reqops/connector-core';
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
  if (!expiresSoon) return integrationService.decryptAccessToken(row, env.REQOPS_ENCRYPTION_KEY);

  const adapter = adapterFor(row.provider);
  const refreshToken = integrationService.decryptRefreshToken(row, env.REQOPS_ENCRYPTION_KEY);
  if (!adapter.refreshTokens || !refreshToken) {
    // No refresh path — use what we have and let the provider reject it if stale.
    return integrationService.decryptAccessToken(row, env.REQOPS_ENCRYPTION_KEY);
  }
  const refreshed = await adapter.refreshTokens({
    config: oauthConfigFor(env, row.provider),
    refreshToken,
  });
  await integrationService.saveRefreshedTokens(db, env.REQOPS_ENCRYPTION_KEY, row.id, refreshed);
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

/** Pushes ReqOps-side task changes back to every linked external system. */
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
