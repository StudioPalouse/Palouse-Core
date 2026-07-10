import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { integrations, syncCursors, type Database } from '@palouse/db';
import { conflict, notFound, type Integration, type IntegrationProvider } from '@palouse/shared';
import { decryptSecret, encryptSecret, type OAuthTokenSet } from '@palouse/connector-core';

export type IntegrationRow = typeof integrations.$inferSelect;

export function toDto(row: IntegrationRow): Integration {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider,
    accountLabel: row.accountLabel,
    status: row.status,
    scopes: row.scopes,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listIntegrations(db: Database, workspaceId: string): Promise<Integration[]> {
  const rows = await db
    .select()
    .from(integrations)
    .where(eq(integrations.workspaceId, workspaceId))
    .orderBy(integrations.createdAt);
  return rows.map(toDto);
}

export async function createIntegration(
  db: Database,
  encryptionKey: string,
  workspaceId: string,
  provider: IntegrationProvider,
  tokens: OAuthTokenSet,
): Promise<Integration> {
  // Reconnecting the same external account replaces its tokens instead of duplicating.
  if (tokens.externalAccountId) {
    const [existing] = await db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.workspaceId, workspaceId),
          eq(integrations.provider, provider),
          eq(integrations.externalAccountId, tokens.externalAccountId),
        ),
      )
      .limit(1);
    if (existing) {
      const [updated] = await db
        .update(integrations)
        .set({
          oauthAccessTokenEnc: encryptSecret(tokens.accessToken, encryptionKey),
          oauthRefreshTokenEnc: tokens.refreshToken
            ? encryptSecret(tokens.refreshToken, encryptionKey)
            : existing.oauthRefreshTokenEnc,
          oauthExpiresAt: tokens.expiresAt ?? null,
          scopes: tokens.scopes,
          accountLabel: tokens.accountLabel,
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, existing.id))
        .returning();
      return toDto(updated!);
    }
  }

  const [row] = await db
    .insert(integrations)
    .values({
      workspaceId,
      provider,
      accountLabel: tokens.accountLabel,
      oauthAccessTokenEnc: encryptSecret(tokens.accessToken, encryptionKey),
      oauthRefreshTokenEnc: tokens.refreshToken
        ? encryptSecret(tokens.refreshToken, encryptionKey)
        : null,
      oauthExpiresAt: tokens.expiresAt ?? null,
      scopes: tokens.scopes,
      externalAccountId: tokens.externalAccountId ?? null,
    })
    .returning();
  return toDto(row!);
}

export async function getIntegrationRow(db: Database, id: string): Promise<IntegrationRow> {
  const [row] = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
  if (!row) throw notFound('Integration not found');
  return row;
}

export async function deleteIntegration(
  db: Database,
  workspaceId: string,
  id: string,
): Promise<void> {
  const deleted = await db
    .delete(integrations)
    .where(and(eq(integrations.id, id), eq(integrations.workspaceId, workspaceId)))
    .returning({ id: integrations.id });
  if (deleted.length === 0) throw notFound('Integration not found');
}

export function decryptAccessToken(row: IntegrationRow, encryptionKey: string): string {
  return decryptSecret(Buffer.from(row.oauthAccessTokenEnc), encryptionKey);
}

export function decryptRefreshToken(
  row: IntegrationRow,
  encryptionKey: string,
): string | undefined {
  if (!row.oauthRefreshTokenEnc) return undefined;
  return decryptSecret(Buffer.from(row.oauthRefreshTokenEnc), encryptionKey);
}

export async function saveRefreshedTokens(
  db: Database,
  encryptionKey: string,
  id: string,
  tokens: { accessToken: string; refreshToken?: string; expiresAt?: Date },
): Promise<void> {
  await db
    .update(integrations)
    .set({
      oauthAccessTokenEnc: encryptSecret(tokens.accessToken, encryptionKey),
      ...(tokens.refreshToken
        ? { oauthRefreshTokenEnc: encryptSecret(tokens.refreshToken, encryptionKey) }
        : {}),
      oauthExpiresAt: tokens.expiresAt ?? null,
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, id));
}

/** sha256 hex of a webhook route nonce or Graph clientState. */
export function hashWebhookToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// How long an armed integration accepts a handshake / registration.
const WEBHOOK_HANDSHAKE_TTL_MS = 15 * 60_000;

export interface ArmedWebhook {
  nonce: string;
  clientState: string;
}

/**
 * Prepares an integration for webhook (re)registration: mints a random route
 * nonce and Graph clientState, stores only their sha256 hashes, and opens a
 * 15-minute handshake window. The plaintexts are returned exactly once; they
 * live on only in the callback URL and subscription registered with the
 * provider. Arming again rotates both values and re-opens the window.
 */
export async function armWebhook(db: Database, id: string): Promise<ArmedWebhook> {
  const nonce = randomBytes(24).toString('base64url');
  const clientState = randomBytes(24).toString('base64url');
  const updated = await db
    .update(integrations)
    .set({
      webhookNonceHash: hashWebhookToken(nonce),
      webhookNonceExpiresAt: new Date(Date.now() + WEBHOOK_HANDSHAKE_TTL_MS),
      webhookClientStateHash: hashWebhookToken(clientState),
      webhookStatus: 'pending',
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, id))
    .returning({ id: integrations.id });
  if (updated.length === 0) throw notFound('Integration not found');
  return { nonce, clientState };
}

export async function setWebhookSubscription(
  db: Database,
  id: string,
  subscriptionId: string,
  expiresAt?: Date,
): Promise<void> {
  await db
    .update(integrations)
    .set({
      webhookSubscriptionId: subscriptionId,
      webhookExpiresAt: expiresAt ?? null,
      webhookStatus: 'active',
      webhookNonceExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, id));
}

/**
 * Persists an Asana handshake secret. Only an armed integration inside its
 * handshake window may set (or rotate) the secret, so an unsolicited or
 * replayed handshake cannot overwrite an established one; rotating requires
 * an explicit re-arm (resubscription).
 */
export async function setWebhookSecret(
  db: Database,
  encryptionKey: string,
  id: string,
  secret: string,
): Promise<void> {
  const updated = await db
    .update(integrations)
    .set({
      webhookSecretEnc: encryptSecret(secret, encryptionKey),
      webhookStatus: 'active',
      webhookNonceExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integrations.id, id),
        eq(integrations.webhookStatus, 'pending'),
        gt(integrations.webhookNonceExpiresAt, new Date()),
      ),
    )
    .returning({ id: integrations.id });
  if (updated.length === 0) {
    throw conflict('Integration is not awaiting a webhook handshake');
  }
}

export function decryptWebhookSecret(
  row: IntegrationRow,
  encryptionKey: string,
): string | undefined {
  if (!row.webhookSecretEnc) return undefined;
  return decryptSecret(Buffer.from(row.webhookSecretEnc), encryptionKey);
}

export async function markSyncResult(
  db: Database,
  id: string,
  result: { ok: boolean },
): Promise<void> {
  await db
    .update(integrations)
    .set(
      result.ok
        ? { lastSyncAt: new Date(), status: 'active', updatedAt: new Date() }
        : { status: 'degraded', updatedAt: new Date() },
    )
    .where(eq(integrations.id, id));
}

export async function getSyncCursor(
  db: Database,
  integrationId: string,
  resource: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ cursor: syncCursors.cursor })
    .from(syncCursors)
    .where(and(eq(syncCursors.integrationId, integrationId), eq(syncCursors.resource, resource)))
    .limit(1);
  return row?.cursor;
}

export async function saveSyncCursor(
  db: Database,
  integrationId: string,
  resource: string,
  cursor: string,
): Promise<void> {
  await db
    .insert(syncCursors)
    .values({ integrationId, resource, cursor })
    .onConflictDoUpdate({
      target: [syncCursors.integrationId, syncCursors.resource],
      set: { cursor, updatedAt: new Date() },
    });
}
