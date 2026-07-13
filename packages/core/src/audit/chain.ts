import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { auditEvents, type Database } from '@palouse/db';
import type { AuditVerifyResult } from '@palouse/shared';
import { computeAuditHash, genesisHash } from '@palouse/shared/audit-chain';

/**
 * Single write funnel for the tamper-evident audit chain. Every audit row is
 * appended here so it gets a per-workspace monotonic `seq`, the previous row's
 * `hash` as `prevHash`, and its own `hash`. All service-level `audit()` helpers
 * and the handful of direct inserters delegate to this function; nothing writes
 * `audit_events` without a chain link. See packages/shared/src/audit-chain.ts
 * for the hash recipe and docs/agent-tasks-and-auditability.md §1d.
 */

/** A drizzle transaction handle (savepoint-capable), for callers already in a tx. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Either the top-level db or an open transaction. */
export type ChainExecutor = Database | Tx;

export interface AuditEventInput {
  workspaceId: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Append one audit event, chained. Serializes writers per workspace with a
 * Postgres transaction-scoped advisory lock so `seq` is gapless and the chain
 * has no forks, even across processes sharing the database. When `db` is already
 * a transaction the work runs in a savepoint and the lock is held to the outer
 * commit; when it is the top-level db this opens its own short transaction.
 */
export async function appendAuditEvent(db: ChainExecutor, evt: AuditEventInput): Promise<void> {
  const payload = evt.payload ?? {};
  await db.transaction(async (tx) => {
    // Per-workspace serialization; auto-released at COMMIT/ROLLBACK. hashtext()
    // returns int4, so we use the two-key advisory lock signature.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('palouse_audit'), hashtext(${evt.workspaceId}))`,
    );
    const tip = await tx
      .select({ seq: auditEvents.seq, hash: auditEvents.hash })
      .from(auditEvents)
      .where(and(eq(auditEvents.workspaceId, evt.workspaceId), isNotNull(auditEvents.seq)))
      .orderBy(desc(auditEvents.seq))
      .limit(1);
    const seq = (tip[0]?.seq ?? 0) + 1;
    const prevHash = tip[0]?.hash ?? genesisHash(evt.workspaceId);
    const at = new Date();
    const hash = computeAuditHash({
      workspaceId: evt.workspaceId,
      seq,
      prevHash,
      actorType: evt.actorType,
      actorId: evt.actorId,
      action: evt.action,
      targetType: evt.targetType,
      targetId: evt.targetId,
      payload,
      at: at.toISOString(),
    });
    await tx.insert(auditEvents).values({
      workspaceId: evt.workspaceId,
      actorType: evt.actorType,
      actorId: evt.actorId,
      action: evt.action,
      targetType: evt.targetType,
      targetId: evt.targetId,
      payload,
      at,
      seq,
      prevHash,
      hash,
    });
  });
}

/**
 * Re-walk a workspace's chain in `seq` order, recomputing every hash from the
 * stored fields. Returns the first row that fails (tampered, deleted, or a seq
 * gap) or `valid: true` with the chain head. Historical rows still awaiting
 * backfill (`seq IS NULL`) are counted, not walked.
 */
export async function verifyChain(db: Database, workspaceId: string): Promise<AuditVerifyResult> {
  const rows = await db
    .select({
      seq: auditEvents.seq,
      prevHash: auditEvents.prevHash,
      hash: auditEvents.hash,
      actorType: auditEvents.actorType,
      actorId: auditEvents.actorId,
      action: auditEvents.action,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      payload: auditEvents.payload,
      at: auditEvents.at,
    })
    .from(auditEvents)
    .where(and(eq(auditEvents.workspaceId, workspaceId), isNotNull(auditEvents.seq)))
    .orderBy(asc(auditEvents.seq));

  const unchainedCount = await countUnchained(db, workspaceId);

  const head = rows[rows.length - 1];
  let expectedPrev = genesisHash(workspaceId);
  let expectedSeq = 1;
  for (const row of rows) {
    const brokenAt = (seq: number): AuditVerifyResult => ({
      valid: false,
      checkedCount: rows.length,
      headSeq: head?.seq ?? null,
      headHash: head?.hash ?? null,
      firstBrokenSeq: seq,
      unchainedCount,
    });
    // A seq that skips ahead means a row was deleted; report the missing seq.
    if (row.seq !== expectedSeq) return brokenAt(expectedSeq);
    if (row.prevHash !== expectedPrev) return brokenAt(row.seq);
    const recomputed = computeAuditHash({
      workspaceId,
      seq: row.seq,
      prevHash: row.prevHash!,
      actorType: row.actorType,
      actorId: row.actorId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      at: row.at.toISOString(),
    });
    if (recomputed !== row.hash) return brokenAt(row.seq);
    expectedPrev = row.hash!;
    expectedSeq += 1;
  }

  return {
    valid: true,
    checkedCount: rows.length,
    headSeq: head?.seq ?? null,
    headHash: head?.hash ?? null,
    firstBrokenSeq: null,
    unchainedCount,
  };
}

async function countUnchained(db: Database, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(and(eq(auditEvents.workspaceId, workspaceId), sql`${auditEvents.seq} is null`));
  return row?.n ?? 0;
}
