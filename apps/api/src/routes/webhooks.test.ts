import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '@palouse/connector-core';
import {
  closeDb,
  getDb,
  integrations,
  organizations,
  workspaces,
  type Database,
} from '@palouse/db';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url));

const { enqueueWebhook } = vi.hoisted(() => ({ enqueueWebhook: vi.fn(async () => {}) }));

vi.mock('../queue.js', () => ({ getSyncQueue: () => ({}) }));
vi.mock('@palouse/queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@palouse/queue')>()),
  enqueueWebhook,
}));

const ENCRYPTION_KEY = '0f'.repeat(32);

let container: StartedPostgreSqlContainer;
let db: Database;
let webhookRoutes: (typeof import('./webhooks.js'))['webhookRoutes'];
let integrationService: typeof import('@palouse/core').integrationService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  db = getDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.REDIS_URL = 'redis://127.0.0.1:6399';
  process.env.BETTER_AUTH_SECRET = 'webhook-test-secret-webhook-test-secret';
  process.env.BETTER_AUTH_URL = 'http://localhost:4000';
  process.env.API_BASE_URL = 'http://localhost:4000';
  process.env.WEB_BASE_URL = 'http://localhost:3000';
  process.env.PALOUSE_ENCRYPTION_KEY = ENCRYPTION_KEY;
  const { _resetEnvForTest } = await import('@palouse/config');
  _resetEnvForTest();

  ({ webhookRoutes } = await import('./webhooks.js'));
  ({ integrationService } = await import('@palouse/core'));
}, 120_000);

afterAll(async () => {
  await closeDb();
  await container?.stop();
});

beforeEach(() => {
  enqueueWebhook.mockClear();
});

async function seedIntegration(provider: 'asana' | 'ms_tasks'): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [org] = await db
    .insert(organizations)
    .values({ name: `Org ${suffix}`, slug: `org-${suffix}` })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ organizationId: org!.id, name: `WS ${suffix}`, slug: `ws-${suffix}` })
    .returning();
  const [row] = await db
    .insert(integrations)
    .values({
      workspaceId: ws!.id,
      provider,
      accountLabel: `acct-${suffix}`,
      oauthAccessTokenEnc: encryptSecret('access-token', ENCRYPTION_KEY),
    })
    .returning({ id: integrations.id });
  return row!.id;
}

async function getRow(id: string) {
  const [row] = await db.select().from(integrations).where(eq(integrations.id, id));
  return row!;
}

function signedAsanaEvent(secret: string, body: string): Record<string, string> {
  return {
    'x-hook-signature': createHmac('sha256', secret).update(body).digest('hex'),
    'content-type': 'application/json',
  };
}

describe('Asana webhook (nonced route)', () => {
  it('accepts a handshake only while armed, then refuses replays', async () => {
    const id = await seedIntegration('asana');
    const { nonce } = await integrationService.armWebhook(db, id);

    const handshake = await webhookRoutes.request(`/asana/${id}/${nonce}`, {
      method: 'POST',
      headers: { 'x-hook-secret': 'first-secret' },
    });
    expect(handshake.status).toBe(200);
    expect(handshake.headers.get('x-hook-secret')).toBe('first-secret');
    const armedRow = await getRow(id);
    expect(armedRow.webhookStatus).toBe('active');
    expect(armedRow.webhookSecretEnc).not.toBeNull();

    // A replayed or unsolicited handshake cannot replace the secret.
    const replay = await webhookRoutes.request(`/asana/${id}/${nonce}`, {
      method: 'POST',
      headers: { 'x-hook-secret': 'attacker-secret' },
    });
    expect(replay.status).toBe(409);
    expect(
      integrationService.decryptWebhookSecret(await getRow(id), ENCRYPTION_KEY),
    ).toBe('first-secret');
  });

  it('rejects a wrong nonce as an unknown integration', async () => {
    const id = await seedIntegration('asana');
    await integrationService.armWebhook(db, id);

    const res = await webhookRoutes.request(`/asana/${id}/wrong-nonce`, {
      method: 'POST',
      headers: { 'x-hook-secret': 'attacker-secret' },
    });
    expect(res.status).toBe(404);
    expect((await getRow(id)).webhookSecretEnc).toBeNull();
  });

  it('refuses a handshake after the arm window expires', async () => {
    const id = await seedIntegration('asana');
    const { nonce } = await integrationService.armWebhook(db, id);
    await db
      .update(integrations)
      .set({ webhookNonceExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(integrations.id, id));

    const res = await webhookRoutes.request(`/asana/${id}/${nonce}`, {
      method: 'POST',
      headers: { 'x-hook-secret': 'late-secret' },
    });
    expect(res.status).toBe(409);
  });

  it('enqueues exactly one job per novel signed event', async () => {
    const id = await seedIntegration('asana');
    const { nonce } = await integrationService.armWebhook(db, id);
    await webhookRoutes.request(`/asana/${id}/${nonce}`, {
      method: 'POST',
      headers: { 'x-hook-secret': 'event-secret' },
    });

    const body = JSON.stringify({ events: [{ id: crypto.randomUUID() }] });
    const first = await webhookRoutes.request(`/asana/${id}/${nonce}`, {
      method: 'POST',
      headers: signedAsanaEvent('event-secret', body),
      body,
    });
    expect(first.status).toBe(200);
    expect(enqueueWebhook).toHaveBeenCalledTimes(1);

    // Duplicate delivery no-ops via the (provider, payloadHash) unique index.
    const dup = await webhookRoutes.request(`/asana/${id}/${nonce}`, {
      method: 'POST',
      headers: signedAsanaEvent('event-secret', body),
      body,
    });
    expect(dup.status).toBe(200);
    expect(enqueueWebhook).toHaveBeenCalledTimes(1);

    const bad = await webhookRoutes.request(`/asana/${id}/${nonce}`, {
      method: 'POST',
      headers: signedAsanaEvent('wrong-secret', body),
      body,
    });
    expect(bad.status).toBe(401);
  });
});

describe('Asana webhook (legacy route)', () => {
  it('verifies events for pre-nonce integrations but refuses handshakes', async () => {
    const id = await seedIntegration('asana');
    await db
      .update(integrations)
      .set({ webhookSecretEnc: encryptSecret('legacy-secret', ENCRYPTION_KEY) })
      .where(eq(integrations.id, id));

    const handshake = await webhookRoutes.request(`/asana/${id}`, {
      method: 'POST',
      headers: { 'x-hook-secret': 'attacker-secret' },
    });
    expect(handshake.status).toBe(409);
    expect(
      integrationService.decryptWebhookSecret(await getRow(id), ENCRYPTION_KEY),
    ).toBe('legacy-secret');

    const body = JSON.stringify({ events: [{ id: crypto.randomUUID() }] });
    const event = await webhookRoutes.request(`/asana/${id}`, {
      method: 'POST',
      headers: signedAsanaEvent('legacy-secret', body),
      body,
    });
    expect(event.status).toBe(200);
    expect(enqueueWebhook).toHaveBeenCalledTimes(1);
  });

  it('stops matching an integration that has rotated onto a nonced route', async () => {
    const id = await seedIntegration('asana');
    await integrationService.armWebhook(db, id);

    const res = await webhookRoutes.request(`/asana/${id}`, {
      method: 'POST',
      headers: { 'x-hook-secret': 'attacker-secret' },
    });
    expect(res.status).toBe(404);
  });
});

describe('Microsoft Graph webhook (nonced route)', () => {
  async function seedGraph(): Promise<{ id: string; nonce: string; clientState: string }> {
    const id = await seedIntegration('ms_tasks');
    const armed = await integrationService.armWebhook(db, id);
    await integrationService.setWebhookSubscription(db, id, `sub-${id}`, new Date(Date.now() + 86_400_000));
    return { id, ...armed };
  }

  function graphBody(notifications: Record<string, unknown>[]): string {
    return JSON.stringify({ value: notifications, marker: crypto.randomUUID() });
  }

  it('rejects a forged notification that only knows the integration id', async () => {
    const { id, nonce } = await seedGraph();
    const res = await webhookRoutes.request(`/ms_tasks/${id}/${nonce}`, {
      method: 'POST',
      body: graphBody([{ clientState: id, subscriptionId: `sub-${id}` }]),
    });
    expect(res.status).toBe(401);
    expect(enqueueWebhook).not.toHaveBeenCalled();
  });

  it('rejects the right clientState on the wrong subscription', async () => {
    const { id, nonce, clientState } = await seedGraph();
    const res = await webhookRoutes.request(`/ms_tasks/${id}/${nonce}`, {
      method: 'POST',
      body: graphBody([{ clientState, subscriptionId: 'other-subscription' }]),
    });
    expect(res.status).toBe(401);
  });

  it('accepts a valid notification exactly once', async () => {
    const { id, nonce, clientState } = await seedGraph();
    const body = graphBody([{ clientState, subscriptionId: `sub-${id}` }]);
    const res = await webhookRoutes.request(`/ms_tasks/${id}/${nonce}`, {
      method: 'POST',
      body,
    });
    expect(res.status).toBe(202);
    expect(enqueueWebhook).toHaveBeenCalledTimes(1);

    const dup = await webhookRoutes.request(`/ms_tasks/${id}/${nonce}`, {
      method: 'POST',
      body,
    });
    expect(dup.status).toBe(202);
    expect(enqueueWebhook).toHaveBeenCalledTimes(1);
  });

  it('still echoes the subscription validation token', async () => {
    const { id, nonce } = await seedGraph();
    const res = await webhookRoutes.request(`/ms_tasks/${id}/${nonce}?validationToken=tok-123`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('tok-123');
  });
});

describe('Microsoft Graph webhook (legacy route)', () => {
  it('requires the subscription id to match during the transition window', async () => {
    const id = await seedIntegration('ms_tasks');
    await db
      .update(integrations)
      .set({ webhookSubscriptionId: `sub-${id}` })
      .where(eq(integrations.id, id));

    const forged = await webhookRoutes.request(`/ms_tasks/${id}`, {
      method: 'POST',
      body: JSON.stringify({ value: [{ clientState: id, subscriptionId: 'guessed' }] }),
    });
    expect(forged.status).toBe(401);

    const valid = await webhookRoutes.request(`/ms_tasks/${id}`, {
      method: 'POST',
      body: JSON.stringify({
        value: [{ clientState: id, subscriptionId: `sub-${id}` }],
        marker: crypto.randomUUID(),
      }),
    });
    expect(valid.status).toBe(202);
    expect(enqueueWebhook).toHaveBeenCalledTimes(1);
  });

  it('stops matching an integration that has rotated onto a nonced route', async () => {
    const id = await seedIntegration('ms_tasks');
    await integrationService.armWebhook(db, id);
    await integrationService.setWebhookSubscription(db, id, `sub-${id}`);

    const res = await webhookRoutes.request(`/ms_tasks/${id}`, {
      method: 'POST',
      body: JSON.stringify({ value: [{ clientState: id, subscriptionId: `sub-${id}` }] }),
    });
    expect(res.status).toBe(404);
  });
});
