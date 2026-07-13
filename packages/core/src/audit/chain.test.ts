import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEvents,
  backfillAuditChain,
  closeDb,
  getDb,
  organizations,
  workspaces,
  type Database,
} from '@palouse/db';
import { genesisHash } from '@palouse/shared/audit-chain';
import { appendAuditEvent, verifyChain } from './chain.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

let container: StartedPostgreSqlContainer;
let db: Database;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  db = getDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}, 120_000);

afterAll(async () => {
  await closeDb();
  await container?.stop();
});

/** A fresh workspace per test so chains never collide. */
async function freshWorkspace(): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [org] = await db
    .insert(organizations)
    .values({ name: `Org ${suffix}`, slug: `org-${suffix}` })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ organizationId: org!.id, name: `WS ${suffix}`, slug: `ws-${suffix}` })
    .returning();
  return ws!.id;
}

async function chainRows(workspaceId: string) {
  return db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.workspaceId, workspaceId))
    .orderBy(asc(auditEvents.seq));
}

describe('appendAuditEvent + verifyChain', () => {
  it('assigns gapless per-workspace seq and links prevHash to the prior hash', async () => {
    const ws = await freshWorkspace();
    for (let i = 0; i < 3; i++) {
      await appendAuditEvent(db, {
        workspaceId: ws,
        actorType: 'user',
        actorId: null,
        action: `task.event_${i}`,
        targetType: 'task',
        targetId: null,
        payload: { i },
      });
    }
    const rows = await chainRows(ws);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows[0]!.prevHash).toBe(genesisHash(ws));
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash);
    expect(rows[2]!.prevHash).toBe(rows[1]!.hash);

    const result = await verifyChain(db, ws);
    expect(result).toMatchObject({
      valid: true,
      checkedCount: 3,
      headSeq: 3,
      firstBrokenSeq: null,
      unchainedCount: 0,
    });
    expect(result.headHash).toBe(rows[2]!.hash);
  });

  it('serializes concurrent writers into a gapless chain', async () => {
    const ws = await freshWorkspace();
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        appendAuditEvent(db, {
          workspaceId: ws,
          actorType: 'agent',
          actorId: null,
          action: `mcp.tool_${i}`,
          targetType: 'agent',
          targetId: null,
          payload: { i },
        }),
      ),
    );
    const rows = await chainRows(ws);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect((await verifyChain(db, ws)).valid).toBe(true);
  });

  it('keeps two workspaces on independent chains', async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    await appendAuditEvent(db, base(a));
    await appendAuditEvent(db, base(b));
    await appendAuditEvent(db, base(a));
    const rowsA = await chainRows(a);
    const rowsB = await chainRows(b);
    expect(rowsA.map((r) => r.seq)).toEqual([1, 2]);
    expect(rowsB.map((r) => r.seq)).toEqual([1]);
    expect(rowsA[0]!.prevHash).toBe(genesisHash(a));
    expect(rowsB[0]!.prevHash).toBe(genesisHash(b));
    expect((await verifyChain(db, a)).valid).toBe(true);
    expect((await verifyChain(db, b)).valid).toBe(true);
  });

  it('detects a tampered payload at the tampered seq', async () => {
    const ws = await freshWorkspace();
    for (let i = 0; i < 4; i++) await appendAuditEvent(db, base(ws, { i }));
    // Edit row 2's payload directly, as an attacker with DB access would.
    await db
      .update(auditEvents)
      .set({ payload: { i: 999 } })
      .where(and(eq(auditEvents.workspaceId, ws), eq(auditEvents.seq, 2)));
    const result = await verifyChain(db, ws);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenSeq).toBe(2);
  });

  it('detects a deleted row as a seq gap', async () => {
    const ws = await freshWorkspace();
    for (let i = 0; i < 4; i++) await appendAuditEvent(db, base(ws, { i }));
    await db
      .delete(auditEvents)
      .where(and(eq(auditEvents.workspaceId, ws), eq(auditEvents.seq, 3)));
    const result = await verifyChain(db, ws);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenSeq).toBe(3);
  });
});

describe('backfillAuditChain', () => {
  it('chains historical unchained rows in (at, id) order and verifies clean', async () => {
    const ws = await freshWorkspace();
    // Insert rows straight to the table with no seq, out of insertion order.
    const t = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min, 0));
    await db.insert(auditEvents).values([
      { workspaceId: ws, actorType: 'user', action: 'a.third', at: t(30), payload: {} },
      { workspaceId: ws, actorType: 'user', action: 'a.first', at: t(10), payload: {} },
      { workspaceId: ws, actorType: 'user', action: 'a.second', at: t(20), payload: {} },
    ]);
    // Before backfill: everything is unchained.
    const before = await verifyChain(db, ws);
    expect(before).toMatchObject({ checkedCount: 0, unchainedCount: 3 });

    const result = await backfillAuditChain(db);
    expect(result.rowsChained).toBeGreaterThanOrEqual(3);

    const rows = await chainRows(ws);
    expect(rows.map((r) => r.action)).toEqual(['a.first', 'a.second', 'a.third']);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows[0]!.prevHash).toBe(genesisHash(ws));

    const after = await verifyChain(db, ws);
    expect(after).toMatchObject({ valid: true, checkedCount: 3, unchainedCount: 0 });
  });

  it('is idempotent and appends stragglers after the existing tip', async () => {
    const ws = await freshWorkspace();
    await appendAuditEvent(db, base(ws)); // seq 1, chained live
    // A straggler written by old code during a deploy window: no seq.
    await db.insert(auditEvents).values({
      workspaceId: ws,
      actorType: 'system',
      action: 'a.straggler',
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
      payload: {},
    });
    await backfillAuditChain(db);
    const rows = await chainRows(ws);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    // Straggler is chained after the live tip even though its `at` is older.
    expect(rows[1]!.action).toBe('a.straggler');
    expect((await verifyChain(db, ws)).valid).toBe(true);
    // Re-running is a no-op.
    const again = await backfillAuditChain(db);
    expect(again.rowsChained).toBe(0);
  });
});

function base(
  workspaceId: string,
  payload: Record<string, unknown> = {},
): Parameters<typeof appendAuditEvent>[1] {
  return {
    workspaceId,
    actorType: 'user',
    actorId: null,
    action: 'task.created',
    targetType: 'task',
    targetId: null,
    payload,
  };
}
