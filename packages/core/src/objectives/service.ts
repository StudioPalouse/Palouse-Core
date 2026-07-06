import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import { auditEvents, keyResults, objectives, type Database } from '@palouse/db';
import {
  notFound,
  type Actor,
  type CreateKeyResultInput,
  type CreateObjectiveInput,
  type ImportObjectivesInput,
  type KeyResult,
  type ListObjectivesQuery,
  type Objective,
  type ObjectiveDetail,
  type ObjectiveImportItem,
  type ObjectiveImportResult,
  type ObjectiveListItem,
  type UpdateKeyResultInput,
  type UpdateObjectiveInput,
} from '@palouse/shared';
import { parseObjectivesCsv } from './csv.js';

/**
 * Attainment of a single key result as a 0-100 percentage. Linear between the
 * start and target values and clamped to the range, so it works for both
 * increase goals (target > start) and decrease goals (target < start). When
 * start equals target there is no range to measure against, so it is all-or-
 * nothing on reaching the target.
 */
function keyResultProgress(start: number, target: number, current: number): number {
  if (start === target) return current >= target ? 100 : 0;
  const ratio = (current - start) / (target - start);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/** Objective progress is the average attainment of its key results (0 if none). */
function rollup(progresses: number[]): number {
  if (progresses.length === 0) return 0;
  return Math.round(progresses.reduce((a, b) => a + b, 0) / progresses.length);
}

function toDto(row: typeof objectives.$inferSelect): Objective {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    descriptionMd: row.descriptionMd,
    area: row.area,
    status: row.status,
    startDate: row.startDate?.toISOString() ?? null,
    targetDate: row.targetDate?.toISOString() ?? null,
    origin: row.origin,
    createdByUserId: row.createdByUserId,
    createdByAgentId: row.createdByAgentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function keyResultToDto(row: typeof keyResults.$inferSelect): KeyResult {
  return {
    id: row.id,
    objectiveId: row.objectiveId,
    name: row.name,
    startValue: row.startValue,
    targetValue: row.targetValue,
    currentValue: row.currentValue,
    unit: row.unit,
    progress: keyResultProgress(row.startValue, row.targetValue, row.currentValue),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listObjectives(
  db: Database,
  query: ListObjectivesQuery,
): Promise<{ objectives: ObjectiveListItem[]; total: number }> {
  const conditions: SQL[] = [eq(objectives.workspaceId, query.workspaceId)];
  if (query.status) conditions.push(eq(objectives.status, query.status));
  if (query.area) conditions.push(ilike(objectives.area, `%${query.area}%`));
  if (query.search) conditions.push(ilike(objectives.title, `%${query.search}%`));
  const where = and(...conditions);

  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(objectives)
      .where(where)
      .orderBy(desc(objectives.updatedAt))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(objectives)
      .where(where),
  ]);

  // Roll up each objective's key results into a count and average progress in a
  // single query keyed by this page's objective ids (avoids a fan-out join).
  const ids = rows.map((r) => r.id);
  const rollups = new Map<string, { count: number; progress: number }>();
  for (const id of ids) rollups.set(id, { count: 0, progress: 0 });
  if (ids.length > 0) {
    const krRows = await db
      .select({
        objectiveId: keyResults.objectiveId,
        startValue: keyResults.startValue,
        targetValue: keyResults.targetValue,
        currentValue: keyResults.currentValue,
      })
      .from(keyResults)
      .where(inArray(keyResults.objectiveId, ids));
    const byObjective = new Map<string, number[]>();
    for (const kr of krRows) {
      const list = byObjective.get(kr.objectiveId) ?? [];
      list.push(keyResultProgress(kr.startValue, kr.targetValue, kr.currentValue));
      byObjective.set(kr.objectiveId, list);
    }
    for (const [objectiveId, progresses] of byObjective) {
      rollups.set(objectiveId, { count: progresses.length, progress: rollup(progresses) });
    }
  }

  return {
    objectives: rows.map((r) => {
      const roll = rollups.get(r.id)!;
      return { ...toDto(r), keyResultCount: roll.count, progress: roll.progress };
    }),
    total: count?.total ?? 0,
  };
}

/**
 * Bulk-create native objectives from a CSV. `dryRun` parses and returns the
 * preview (counts + per-row errors) without writing; otherwise every parsed
 * objective is created. Invalid rows are skipped and reported, not fatal.
 */
export async function importObjectives(
  db: Database,
  workspaceId: string,
  actor: Actor,
  input: ImportObjectivesInput,
): Promise<ObjectiveImportResult> {
  const { objectives, errors } = parseObjectivesCsv(input.csv);
  const keyResultCount = objectives.reduce((n, o) => n + (o.keyResults?.length ?? 0), 0);
  const items: ObjectiveImportItem[] = objectives.map((o) => ({
    title: o.title,
    status: o.status ?? 'planning',
    keyResultCount: o.keyResults?.length ?? 0,
  }));

  if (!input.dryRun) {
    for (const objective of objectives) {
      await createObjective(db, workspaceId, actor, objective);
    }
  }

  return {
    dryRun: input.dryRun ?? false,
    objectiveCount: objectives.length,
    keyResultCount,
    objectives: items,
    errors,
  };
}

async function loadObjectiveRow(
  db: Database,
  workspaceId: string,
  objectiveId: string,
): Promise<typeof objectives.$inferSelect> {
  const [row] = await db
    .select()
    .from(objectives)
    .where(and(eq(objectives.id, objectiveId), eq(objectives.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw notFound('Objective not found');
  return row;
}

export async function getObjective(
  db: Database,
  workspaceId: string,
  objectiveId: string,
): Promise<ObjectiveDetail> {
  const row = await loadObjectiveRow(db, workspaceId, objectiveId);
  const krRows = await db
    .select()
    .from(keyResults)
    .where(eq(keyResults.objectiveId, objectiveId))
    .orderBy(asc(keyResults.createdAt));
  return {
    objective: toDto(row),
    keyResults: krRows.map(keyResultToDto),
  };
}

function keyResultValues(input: CreateKeyResultInput, actor: Actor) {
  return {
    name: input.name,
    startValue: input.startValue,
    targetValue: input.targetValue,
    currentValue: input.currentValue ?? input.startValue,
    unit: input.unit ?? null,
    createdByUserId: actor.type === 'user' ? actor.id : null,
  };
}

export async function createObjective(
  db: Database,
  workspaceId: string,
  actor: Actor,
  input: CreateObjectiveInput,
): Promise<Objective> {
  const objective = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(objectives)
      .values({
        workspaceId,
        title: input.title,
        descriptionMd: input.descriptionMd ?? null,
        area: input.area ?? null,
        // Omit status when unset so the DB default ('planning') applies.
        ...(input.status ? { status: input.status } : {}),
        startDate: input.startDate ? new Date(input.startDate) : null,
        targetDate: input.targetDate ? new Date(input.targetDate) : null,
        origin: actor.type,
        createdByUserId: actor.type === 'user' ? actor.id : null,
        createdByAgentId: actor.type === 'agent' ? actor.id : null,
      })
      .returning();

    if (input.keyResults?.length) {
      await tx
        .insert(keyResults)
        .values(
          input.keyResults.map((kr) => ({ objectiveId: row!.id, ...keyResultValues(kr, actor) })),
        );
    }
    return row!;
  });

  await audit(db, workspaceId, actor, 'objective.created', objective.id);
  return toDto(objective);
}

export async function updateObjective(
  db: Database,
  workspaceId: string,
  actor: Actor,
  objectiveId: string,
  input: UpdateObjectiveInput,
): Promise<Objective> {
  await loadObjectiveRow(db, workspaceId, objectiveId);

  const patch: Partial<typeof objectives.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.descriptionMd !== undefined) patch.descriptionMd = input.descriptionMd;
  if (input.area !== undefined) patch.area = input.area;
  if (input.status !== undefined) patch.status = input.status;
  if (input.startDate !== undefined)
    patch.startDate = input.startDate ? new Date(input.startDate) : null;
  if (input.targetDate !== undefined)
    patch.targetDate = input.targetDate ? new Date(input.targetDate) : null;

  const [row] = await db
    .update(objectives)
    .set(patch)
    .where(and(eq(objectives.id, objectiveId), eq(objectives.workspaceId, workspaceId)))
    .returning();
  if (!row) throw notFound('Objective not found');
  await audit(db, workspaceId, actor, 'objective.updated', objectiveId, {
    fields: Object.keys(input),
  });
  return toDto(row);
}

export async function addKeyResult(
  db: Database,
  workspaceId: string,
  actor: Actor,
  objectiveId: string,
  input: CreateKeyResultInput,
): Promise<KeyResult> {
  await loadObjectiveRow(db, workspaceId, objectiveId);
  const [row] = await db
    .insert(keyResults)
    .values({ objectiveId, ...keyResultValues(input, actor) })
    .returning();
  await touchObjective(db, objectiveId);
  await audit(db, workspaceId, actor, 'objective.key_result_added', objectiveId, {
    keyResultId: row!.id,
  });
  return keyResultToDto(row!);
}

export async function updateKeyResult(
  db: Database,
  workspaceId: string,
  actor: Actor,
  objectiveId: string,
  keyResultId: string,
  input: UpdateKeyResultInput,
): Promise<KeyResult> {
  await loadObjectiveRow(db, workspaceId, objectiveId);

  const patch: Partial<typeof keyResults.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.startValue !== undefined) patch.startValue = input.startValue;
  if (input.targetValue !== undefined) patch.targetValue = input.targetValue;
  if (input.currentValue !== undefined) patch.currentValue = input.currentValue;
  if (input.unit !== undefined) patch.unit = input.unit;

  const [row] = await db
    .update(keyResults)
    .set(patch)
    .where(and(eq(keyResults.id, keyResultId), eq(keyResults.objectiveId, objectiveId)))
    .returning();
  if (!row) throw notFound('Key result not found');
  await touchObjective(db, objectiveId);
  await audit(db, workspaceId, actor, 'objective.key_result_updated', objectiveId, {
    keyResultId,
    fields: Object.keys(input),
  });
  return keyResultToDto(row);
}

export async function removeKeyResult(
  db: Database,
  workspaceId: string,
  actor: Actor,
  objectiveId: string,
  keyResultId: string,
): Promise<void> {
  await loadObjectiveRow(db, workspaceId, objectiveId);
  const [row] = await db
    .delete(keyResults)
    .where(and(eq(keyResults.id, keyResultId), eq(keyResults.objectiveId, objectiveId)))
    .returning({ id: keyResults.id });
  if (!row) throw notFound('Key result not found');
  await touchObjective(db, objectiveId);
  await audit(db, workspaceId, actor, 'objective.key_result_removed', objectiveId, { keyResultId });
}

/** Bump the parent objective's updatedAt so list ordering reflects KR edits. */
async function touchObjective(db: Database, objectiveId: string): Promise<void> {
  await db.update(objectives).set({ updatedAt: new Date() }).where(eq(objectives.id, objectiveId));
}

async function audit(
  db: Database,
  workspaceId: string,
  actor: Actor,
  action: string,
  targetId: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(auditEvents).values({
    workspaceId,
    actorType: actor.type,
    actorId: actor.id,
    action,
    targetType: 'objective',
    targetId,
    payload,
  });
}
