import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  agentHandoffs,
  agents,
  auditEvents,
  handoffEvents,
  tasks,
  type Database,
} from '@palouse/db';
import {
  conflict,
  handoffState,
  isTerminal,
  notFound,
  type CreateHandoffInput,
  type Handoff,
  type HandoffEvent,
  type HandoffListItem,
  type ListHandoffsQuery,
  type ReviewHandoffInput,
  type UsageReport,
} from '@palouse/shared';
import { recordGeneration } from '../usage/service.js';

const MAX_REQUEUES = 3;
const HEARTBEAT_GRACE_SECONDS = 180;
const QUEUED_TTL_HOURS = 24;

type HandoffRow = typeof agentHandoffs.$inferSelect;

export function toDto(row: HandoffRow): Handoff {
  return {
    id: row.id,
    taskId: row.taskId,
    workspaceId: row.workspaceId,
    actorAgentId: row.actorAgentId,
    state: row.state,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    deadlineAt: row.deadlineAt?.toISOString() ?? null,
    deadlineMinutes: row.deadlineMinutes,
    requeueCount: row.requeueCount,
    resultSummaryMd: row.resultSummaryMd,
    failureReason: row.failureReason,
    requestedByUserId: row.requestedByUserId,
    reviewRequired: row.reviewRequired,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewDecision: row.reviewDecision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function eventToDto(row: typeof handoffEvents.$inferSelect): HandoffEvent {
  return {
    id: row.id,
    handoffId: row.handoffId,
    kind: row.kind,
    payload: row.payload,
    at: row.at.toISOString(),
  };
}

/** A claim grants the agent the handoff plus the claim token it must present on every later call. */
export interface ClaimedHandoff {
  handoff: Handoff;
  claimToken: string;
}

export async function createHandoff(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  taskId: string,
  input: CreateHandoffInput,
): Promise<Handoff> {
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!task) throw notFound('Task not found');

  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, input.agentId), eq(agents.workspaceId, workspaceId)))
    .limit(1);
  if (!agent) throw notFound('Agent not found');

  const [existing] = await db
    .select({ id: agentHandoffs.id })
    .from(agentHandoffs)
    .where(
      and(
        eq(agentHandoffs.taskId, taskId),
        sql`${agentHandoffs.state} IN ('queued', 'claimed', 'in_progress', 'needs_review')`,
      ),
    )
    .limit(1);
  if (existing) throw conflict('Task already has an active handoff');

  const [row] = await db
    .insert(agentHandoffs)
    .values({
      taskId,
      workspaceId,
      actorAgentId: input.agentId,
      requestedByUserId: actorUserId,
      reviewRequired: input.reviewRequired,
      deadlineMinutes: input.deadlineMinutes,
    })
    .returning();
  await recordEvent(db, row!.id, 'queued', { agentId: input.agentId });
  await audit(db, workspaceId, 'user', actorUserId, 'handoff.created', row!.id, {
    taskId,
    agentId: input.agentId,
  });
  return toDto(row!);
}

/**
 * Atomic claim: `FOR UPDATE SKIP LOCKED` guarantees two racing agents each get
 * a different row or a clean miss — exactly one winner per handoff.
 */
export async function claimNext(
  db: Database,
  agentId: string,
  workspaceId: string,
  taskId?: string,
): Promise<ClaimedHandoff | null> {
  const rows = await db.execute<HandoffRow & Record<string, unknown>>(sql`
    UPDATE agent_handoffs SET
      state = 'claimed', claim_token = gen_random_uuid(), claimed_at = now(),
      deadline_at = now() + (deadline_minutes * interval '1 minute'), updated_at = now()
    WHERE id = (
      SELECT id FROM agent_handoffs
      WHERE actor_agent_id = ${agentId} AND workspace_id = ${workspaceId} AND state = 'queued'
        AND (${taskId ?? null}::uuid IS NULL OR task_id = ${taskId ?? null})
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *;
  `);
  const raw = rows[0];
  if (!raw) return null;
  const row = rawToRow(raw);
  await recordEvent(db, row.id, 'claimed', { agentId });
  await audit(db, row.workspaceId, 'agent', agentId, 'handoff.claimed', row.id, {
    taskId: row.taskId,
  });
  return { handoff: toDto(row), claimToken: row.claimToken! };
}

/** Last usage increment riding on a lifecycle call becomes one generation row. */
async function recordLifecycleUsage(
  db: Database,
  row: HandoffRow,
  usage: UsageReport | undefined,
): Promise<void> {
  if (!usage) return;
  await recordGeneration(db, {
    handoffId: row.id,
    workspaceId: row.workspaceId,
    agentId: row.actorAgentId,
    usage,
  });
}

/** Refresh the deadline; first heartbeat moves claimed → in_progress. */
export async function heartbeat(
  db: Database,
  claimToken: string,
  usage?: UsageReport,
): Promise<Handoff> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    UPDATE agent_handoffs SET
      last_heartbeat_at = now(),
      deadline_at = now() + (deadline_minutes * interval '1 minute'),
      state = CASE WHEN state = 'claimed' THEN 'in_progress'::handoff_state ELSE state END,
      updated_at = now()
    WHERE claim_token = ${claimToken} AND state IN ('claimed', 'in_progress')
    RETURNING *;
  `);
  const raw = rows[0];
  if (!raw) throw conflict('No active handoff for this claim token');
  const row = rawToRow(raw);
  await recordLifecycleUsage(db, row, usage);
  return toDto(row);
}

export async function complete(
  db: Database,
  claimToken: string,
  resultSummaryMd: string,
  usage?: UsageReport,
): Promise<Handoff> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    UPDATE agent_handoffs SET
      state = CASE WHEN review_required THEN 'needs_review'::handoff_state ELSE 'completed'::handoff_state END,
      result_summary_md = ${resultSummaryMd}, updated_at = now()
    WHERE claim_token = ${claimToken} AND state IN ('claimed', 'in_progress')
    RETURNING *;
  `);
  const raw = rows[0];
  if (!raw) throw conflict('No active handoff for this claim token');
  const row = rawToRow(raw);
  await recordLifecycleUsage(db, row, usage);
  await recordEvent(db, row.id, row.state === 'needs_review' ? 'review_requested' : 'completed', {});
  await audit(db, row.workspaceId, 'agent', row.actorAgentId, 'handoff.completed', row.id, {
    state: row.state,
  });
  return toDto(row);
}

export async function fail(
  db: Database,
  claimToken: string,
  reason: string,
  usage?: UsageReport,
): Promise<Handoff> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    UPDATE agent_handoffs SET
      state = 'failed'::handoff_state, failure_reason = ${reason}, updated_at = now()
    WHERE claim_token = ${claimToken} AND state IN ('claimed', 'in_progress')
    RETURNING *;
  `);
  const raw = rows[0];
  if (!raw) throw conflict('No active handoff for this claim token');
  const row = rawToRow(raw);
  await recordLifecycleUsage(db, row, usage);
  await recordEvent(db, row.id, 'failed', { reason });
  await audit(db, row.workspaceId, 'agent', row.actorAgentId, 'handoff.failed', row.id, { reason });
  return toDto(row);
}

export async function requestReview(
  db: Database,
  claimToken: string,
  summary: string,
): Promise<Handoff> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    UPDATE agent_handoffs SET
      state = 'needs_review'::handoff_state, result_summary_md = ${summary}, updated_at = now()
    WHERE claim_token = ${claimToken} AND state = 'in_progress'
    RETURNING *;
  `);
  const raw = rows[0];
  if (!raw) throw conflict('No in-progress handoff for this claim token');
  const row = rawToRow(raw);
  await recordEvent(db, row.id, 'review_requested', {});
  await audit(db, row.workspaceId, 'agent', row.actorAgentId, 'handoff.review_requested', row.id, {});
  return toDto(row);
}

export async function review(
  db: Database,
  workspaceId: string,
  userId: string,
  handoffId: string,
  input: ReviewHandoffInput,
): Promise<Handoff> {
  const approved = input.decision === 'approved';
  const target = approved ? 'completed' : input.rejectAction === 'fail' ? 'failed' : 'in_progress';
  const rows = await db.execute<Record<string, unknown>>(sql`
    UPDATE agent_handoffs SET
      state = ${target}::handoff_state,
      reviewed_by_user_id = ${userId}, reviewed_at = now(),
      review_decision = ${input.decision}::review_decision,
      failure_reason = CASE WHEN ${target} = 'failed' THEN 'rejected_in_review' ELSE failure_reason END,
      deadline_at = CASE WHEN ${target} = 'in_progress' THEN now() + (deadline_minutes * interval '1 minute') ELSE deadline_at END,
      updated_at = now()
    WHERE id = ${handoffId} AND workspace_id = ${workspaceId} AND state = 'needs_review'
    RETURNING *;
  `);
  const raw = rows[0];
  if (!raw) throw conflict('Handoff is not awaiting review');
  const row = rawToRow(raw);
  await recordEvent(db, row.id, 'reviewed', { decision: input.decision, note: input.note ?? null });
  await audit(db, workspaceId, 'user', userId, 'handoff.reviewed', row.id, {
    decision: input.decision,
    note: input.note ?? null,
    resultState: row.state,
  });
  return toDto(row);
}

export async function cancel(
  db: Database,
  workspaceId: string,
  userId: string,
  handoffId: string,
): Promise<Handoff> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    UPDATE agent_handoffs SET
      state = 'cancelled'::handoff_state, claim_token = NULL, updated_at = now()
    WHERE id = ${handoffId} AND workspace_id = ${workspaceId}
      AND state IN ('queued', 'claimed', 'in_progress', 'needs_review')
    RETURNING *;
  `);
  const raw = rows[0];
  if (!raw) throw conflict('Handoff is not active');
  const row = rawToRow(raw);
  await recordEvent(db, row.id, 'cancelled', { byUserId: userId });
  await audit(db, workspaceId, 'user', userId, 'handoff.cancelled', row.id, {});
  return toDto(row);
}

export async function listHandoffs(
  db: Database,
  query: ListHandoffsQuery,
): Promise<{ handoffs: HandoffListItem[]; total: number }> {
  const conditions = [eq(agentHandoffs.workspaceId, query.workspaceId)];
  if (query.state) conditions.push(eq(agentHandoffs.state, query.state));
  if (query.active) {
    conditions.push(
      inArray(
        agentHandoffs.state,
        handoffState.options.filter((s) => !isTerminal(s)),
      ),
    );
  }
  if (query.agentId) conditions.push(eq(agentHandoffs.actorAgentId, query.agentId));
  if (query.taskId) conditions.push(eq(agentHandoffs.taskId, query.taskId));
  const where = and(...conditions);

  const [rows, [count]] = await Promise.all([
    db
      .select({ handoff: agentHandoffs, taskTitle: tasks.title, agentName: agents.name })
      .from(agentHandoffs)
      .leftJoin(tasks, eq(tasks.id, agentHandoffs.taskId))
      .leftJoin(agents, eq(agents.id, agentHandoffs.actorAgentId))
      .where(where)
      .orderBy(desc(agentHandoffs.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(agentHandoffs).where(where),
  ]);
  return {
    handoffs: rows.map((r) => ({ ...toDto(r.handoff), taskTitle: r.taskTitle, agentName: r.agentName })),
    total: count?.total ?? 0,
  };
}

export async function getHandoff(
  db: Database,
  workspaceId: string,
  handoffId: string,
): Promise<{
  handoff: Handoff;
  events: HandoffEvent[];
  taskTitle: string | null;
  agentName: string | null;
}> {
  const [row] = await db
    .select({ handoff: agentHandoffs, taskTitle: tasks.title, agentName: agents.name })
    .from(agentHandoffs)
    .leftJoin(tasks, eq(tasks.id, agentHandoffs.taskId))
    .leftJoin(agents, eq(agents.id, agentHandoffs.actorAgentId))
    .where(and(eq(agentHandoffs.id, handoffId), eq(agentHandoffs.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw notFound('Handoff not found');
  const events = await db
    .select()
    .from(handoffEvents)
    .where(eq(handoffEvents.handoffId, handoffId))
    .orderBy(handoffEvents.at);
  return {
    handoff: toDto(row.handoff),
    events: events.map(eventToDto),
    taskTitle: row.taskTitle,
    agentName: row.agentName,
  };
}

/**
 * Worker sweep: requeue claimed/in_progress handoffs whose deadline or
 * heartbeat lapsed (up to MAX_REQUEUES, then failed), and cancel queued
 * handoffs nobody claimed within QUEUED_TTL_HOURS.
 */
export async function reapExpired(
  db: Database,
): Promise<{ requeued: number; failed: number; cancelled: number }> {
  const expired = sql`
    state IN ('claimed', 'in_progress') AND (
      deadline_at < now()
      OR (last_heartbeat_at IS NOT NULL AND last_heartbeat_at < now() - ${HEARTBEAT_GRACE_SECONDS} * interval '1 second')
    )`;

  const requeuedRows = await db.execute<Record<string, unknown>>(sql`
    UPDATE agent_handoffs SET
      state = 'queued'::handoff_state, claim_token = NULL, claimed_at = NULL,
      last_heartbeat_at = NULL, deadline_at = NULL,
      requeue_count = requeue_count + 1, updated_at = now()
    WHERE ${expired} AND requeue_count < ${MAX_REQUEUES}
    RETURNING id, workspace_id, actor_agent_id;
  `);
  const failedRows = await db.execute<Record<string, unknown>>(sql`
    UPDATE agent_handoffs SET
      state = 'failed'::handoff_state, failure_reason = 'heartbeat_timeout',
      claim_token = NULL, updated_at = now()
    WHERE ${expired} AND requeue_count >= ${MAX_REQUEUES}
    RETURNING id, workspace_id, actor_agent_id;
  `);
  const cancelledRows = await db.execute<Record<string, unknown>>(sql`
    UPDATE agent_handoffs SET
      state = 'cancelled'::handoff_state, failure_reason = 'claim_ttl_expired', updated_at = now()
    WHERE state = 'queued' AND created_at < now() - ${QUEUED_TTL_HOURS} * interval '1 hour'
    RETURNING id, workspace_id, actor_agent_id;
  `);

  for (const r of requeuedRows) {
    await recordEvent(db, r.id as string, 'requeued', { reason: 'heartbeat_timeout' });
    await audit(db, r.workspace_id as string, 'system', null, 'handoff.requeued', r.id as string, {
      reason: 'heartbeat_timeout',
    });
  }
  for (const r of failedRows) {
    await recordEvent(db, r.id as string, 'failed', { reason: 'heartbeat_timeout' });
    await audit(db, r.workspace_id as string, 'system', null, 'handoff.failed', r.id as string, {
      reason: 'heartbeat_timeout',
    });
  }
  for (const r of cancelledRows) {
    await recordEvent(db, r.id as string, 'cancelled', { reason: 'claim_ttl_expired' });
    await audit(db, r.workspace_id as string, 'system', null, 'handoff.cancelled', r.id as string, {
      reason: 'claim_ttl_expired',
    });
  }
  return {
    requeued: requeuedRows.length,
    failed: failedRows.length,
    cancelled: cancelledRows.length,
  };
}

async function recordEvent(
  db: Database,
  handoffId: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(handoffEvents).values({ handoffId, kind, payload });
}

async function audit(
  db: Database,
  workspaceId: string,
  actorType: 'user' | 'agent' | 'system',
  actorId: string | null,
  action: string,
  targetId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditEvents).values({
    workspaceId,
    actorType,
    actorId,
    action,
    targetType: 'handoff',
    targetId,
    payload,
  });
}

/** db.execute returns snake_case columns; map them back to the drizzle row shape. */
function rawToRow(raw: Record<string, unknown>): HandoffRow {
  return {
    id: raw.id,
    taskId: raw.task_id,
    workspaceId: raw.workspace_id,
    actorAgentId: raw.actor_agent_id,
    state: raw.state,
    claimToken: raw.claim_token,
    claimedAt: toDate(raw.claimed_at),
    lastHeartbeatAt: toDate(raw.last_heartbeat_at),
    deadlineAt: toDate(raw.deadline_at),
    deadlineMinutes: Number(raw.deadline_minutes),
    requeueCount: Number(raw.requeue_count),
    resultSummaryMd: raw.result_summary_md,
    failureReason: raw.failure_reason,
    requestedByUserId: raw.requested_by_user_id,
    reviewRequired: raw.review_required,
    reviewedByUserId: raw.reviewed_by_user_id,
    reviewedAt: toDate(raw.reviewed_at),
    reviewDecision: raw.review_decision,
    createdAt: toDate(raw.created_at)!,
    updatedAt: toDate(raw.updated_at)!,
  } as HandoffRow;
}

function toDate(v: unknown): Date | null {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v as string);
}
