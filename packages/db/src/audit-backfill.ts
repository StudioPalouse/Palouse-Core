import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { computeAuditHash, genesisHash } from '@palouse/shared/audit-chain';
import { auditEvents } from './schema/index.js';
import type { Database } from './index.js';

/**
 * Chain historical `audit_events` rows written before the hash-chain columns
 * existed (or before the chaining code shipped). Assigns each unchained row a
 * per-workspace `seq` in `(at, id)` order, continuing from any existing chain
 * tip, and computes `prevHash`/`hash` with the same shared recipe the live
 * write funnel uses. Idempotent: rows that already carry a `seq` are skipped,
 * so it is safe to re-run to sweep stragglers written during a deploy window.
 *
 * Runs at the end of `pnpm --filter @palouse/db migrate` so a deploy chains the
 * backlog before the new chaining code serves traffic. See
 * packages/shared/src/audit-chain.ts for the recipe.
 */
export interface BackfillResult {
  workspaces: number;
  rowsChained: number;
}

export async function backfillAuditChain(db: Database): Promise<BackfillResult> {
  const pending = await db
    .selectDistinct({ workspaceId: auditEvents.workspaceId })
    .from(auditEvents)
    .where(isNull(auditEvents.seq));
  let rowsChained = 0;
  for (const { workspaceId } of pending) {
    rowsChained += await backfillWorkspace(db, workspaceId);
  }
  return { workspaces: pending.length, rowsChained };
}

async function backfillWorkspace(db: Database, workspaceId: string): Promise<number> {
  return db.transaction(async (tx) => {
    // Serialize against the live append funnel for this workspace.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('palouse_audit'), hashtext(${workspaceId}))`,
    );
    const tip = await tx
      .select({ seq: auditEvents.seq, hash: auditEvents.hash })
      .from(auditEvents)
      .where(and(eq(auditEvents.workspaceId, workspaceId), sql`${auditEvents.seq} is not null`))
      .orderBy(sql`${auditEvents.seq} desc`)
      .limit(1);
    let seq = tip[0]?.seq ?? 0;
    let prevHash = tip[0]?.hash ?? genesisHash(workspaceId);

    const rows = await tx
      .select({
        id: auditEvents.id,
        actorType: auditEvents.actorType,
        actorId: auditEvents.actorId,
        action: auditEvents.action,
        targetType: auditEvents.targetType,
        targetId: auditEvents.targetId,
        payload: auditEvents.payload,
        at: auditEvents.at,
      })
      .from(auditEvents)
      .where(and(eq(auditEvents.workspaceId, workspaceId), isNull(auditEvents.seq)))
      .orderBy(asc(auditEvents.at), asc(auditEvents.id));

    for (const row of rows) {
      seq += 1;
      const hash = computeAuditHash({
        workspaceId,
        seq,
        prevHash,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        at: row.at.toISOString(),
      });
      await tx.update(auditEvents).set({ seq, prevHash, hash }).where(eq(auditEvents.id, row.id));
      prevHash = hash;
    }
    return rows.length;
  });
}
