import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  decisionRelations,
  decisions,
  keyResultProjects,
  keyResults,
  objectives,
  projectItems,
  projects,
  type Database,
} from '@palouse/db';
import { appendAuditEvent } from '../audit/chain.js';
import { diffAuditChanges } from '../audit/changes.js';
import {
  notFound,
  type Actor,
  type CreateKeyResultInput,
  type CreateObjectiveInput,
  type ImportObjectivesInput,
  type KeyResult,
  type KeyResultProject,
  type LinkedDecision,
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

/**
 * Row to DTO. When the key result has linked projects, its current value is
 * derived from their completion (the sum of each project's completed/total
 * fraction) rather than the stored manual value.
 */
function keyResultToDto(
  row: typeof keyResults.$inferSelect,
  linkedProjects: KeyResultProject[] = [],
): KeyResult {
  const derived = linkedProjects.length > 0;
  const currentValue = derived
    ? linkedProjects.reduce((sum, p) => sum + p.fraction, 0)
    : row.currentValue;
  return {
    id: row.id,
    objectiveId: row.objectiveId,
    name: row.name,
    startValue: row.startValue,
    targetValue: row.targetValue,
    currentValue,
    unit: row.unit,
    progress: keyResultProgress(row.startValue, row.targetValue, currentValue),
    derived,
    linkedProjects,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * For the given key-result ids, load their laddered projects enriched with live
 * completion counts, keyed by key-result id. Two grouped queries keep this off
 * the per-KR fan-out path.
 */
async function loadKeyResultProjects(
  db: Database,
  keyResultIds: string[],
): Promise<Map<string, KeyResultProject[]>> {
  const byKeyResult = new Map<string, KeyResultProject[]>();
  if (keyResultIds.length === 0) return byKeyResult;

  const links = await db
    .select({
      keyResultId: keyResultProjects.keyResultId,
      projectId: keyResultProjects.projectId,
      name: projects.name,
    })
    .from(keyResultProjects)
    .innerJoin(projects, eq(projects.id, keyResultProjects.projectId))
    .where(inArray(keyResultProjects.keyResultId, keyResultIds));
  if (links.length === 0) return byKeyResult;

  const projectIds = [...new Set(links.map((l) => l.projectId))];
  const counts = new Map<string, { itemCount: number; completedCount: number }>();
  const itemRows = await db
    .select({
      projectId: projectItems.projectId,
      itemCount: sql<number>`count(*)::int`,
      completedCount: sql<number>`count(${projectItems.completedAt})::int`,
    })
    .from(projectItems)
    .where(inArray(projectItems.projectId, projectIds))
    .groupBy(projectItems.projectId);
  for (const r of itemRows)
    counts.set(r.projectId, { itemCount: r.itemCount, completedCount: r.completedCount });

  for (const link of links) {
    const c = counts.get(link.projectId) ?? { itemCount: 0, completedCount: 0 };
    const fraction = c.itemCount > 0 ? c.completedCount / c.itemCount : 0;
    const list = byKeyResult.get(link.keyResultId) ?? [];
    list.push({
      projectId: link.projectId,
      name: link.name,
      itemCount: c.itemCount,
      completedCount: c.completedCount,
      fraction,
    });
    byKeyResult.set(link.keyResultId, list);
  }
  return byKeyResult;
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
        id: keyResults.id,
        objectiveId: keyResults.objectiveId,
        startValue: keyResults.startValue,
        targetValue: keyResults.targetValue,
        currentValue: keyResults.currentValue,
      })
      .from(keyResults)
      .where(inArray(keyResults.objectiveId, ids));
    // Fold in laddered-project completion so a KR driven by projects rolls up
    // its live progress, not its stale stored value.
    const linkedByKr = await loadKeyResultProjects(
      db,
      krRows.map((kr) => kr.id),
    );
    const byObjective = new Map<string, number[]>();
    for (const kr of krRows) {
      const linked = linkedByKr.get(kr.id);
      const current = linked ? linked.reduce((s, p) => s + p.fraction, 0) : kr.currentValue;
      const list = byObjective.get(kr.objectiveId) ?? [];
      list.push(keyResultProgress(kr.startValue, kr.targetValue, current));
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

/**
 * Reverse lookup: decisions linked to this objective, either directly
 * (`entityType = 'goal'`) or through one of its key results
 * (`entityType = 'key_result'`), so a key-result-level decision rolls up to the
 * objective. Workspace-scoped through the `decisions` join, which is load-bearing
 * since `decision_relations.entityId` is not a hard FK. Served by
 * `decision_relations_entity_idx`. Deduped by decision, so a decision linked to
 * both the objective and one of its KRs appears once. Loaded on demand, not
 * folded into the hot progress query. Reused by Themes C and D.
 */
export async function listRelatedDecisions(
  db: Database,
  workspaceId: string,
  objectiveId: string,
): Promise<LinkedDecision[]> {
  // Key results of this objective, so their `key_result` links roll up here.
  const krRows = await db
    .select({ id: keyResults.id })
    .from(keyResults)
    .where(eq(keyResults.objectiveId, objectiveId));
  const krIds = krRows.map((r) => r.id);

  const entityMatch = or(
    and(eq(decisionRelations.entityType, 'goal'), eq(decisionRelations.entityId, objectiveId)),
    krIds.length
      ? and(
          eq(decisionRelations.entityType, 'key_result'),
          inArray(decisionRelations.entityId, krIds),
        )
      : undefined,
  );

  const rows = await db
    .select({
      relationId: decisionRelations.id,
      decisionId: decisions.id,
      title: decisions.title,
      status: decisions.status,
    })
    .from(decisionRelations)
    .innerJoin(decisions, eq(decisionRelations.decisionId, decisions.id))
    .where(and(eq(decisions.workspaceId, workspaceId), entityMatch))
    .orderBy(desc(decisions.updatedAt));

  const seen = new Set<string>();
  const deduped: LinkedDecision[] = [];
  for (const r of rows) {
    if (seen.has(r.decisionId)) continue;
    seen.add(r.decisionId);
    deduped.push(r);
  }
  return deduped;
}

export async function getObjective(
  db: Database,
  workspaceId: string,
  objectiveId: string,
  options: { includeRelatedDecisions?: boolean } = {},
): Promise<ObjectiveDetail> {
  const row = await loadObjectiveRow(db, workspaceId, objectiveId);
  const krRows = await db
    .select()
    .from(keyResults)
    .where(eq(keyResults.objectiveId, objectiveId))
    .orderBy(asc(keyResults.createdAt));
  const linkedByKr = await loadKeyResultProjects(
    db,
    krRows.map((kr) => kr.id),
  );
  // Gated by the caller: empty unless the decisions capability is on, so decision
  // titles never leak through the objectives gate.
  const relatedDecisions = options.includeRelatedDecisions
    ? await listRelatedDecisions(db, workspaceId, objectiveId)
    : [];
  return {
    objective: toDto(row),
    keyResults: krRows.map((kr) => keyResultToDto(kr, linkedByKr.get(kr.id) ?? [])),
    relatedDecisions,
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
  const existing = await loadObjectiveRow(db, workspaceId, objectiveId);

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
  const changes = diffAuditChanges(toDto(existing), toDto(row), Object.keys(input));
  await audit(db, workspaceId, actor, 'objective.updated', objectiveId, {
    fields: Object.keys(input),
    changes,
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

/** Load a key result, enforcing that it belongs to an objective in the workspace. */
async function loadKeyResultRow(
  db: Database,
  workspaceId: string,
  objectiveId: string,
  keyResultId: string,
): Promise<typeof keyResults.$inferSelect> {
  await loadObjectiveRow(db, workspaceId, objectiveId);
  const [row] = await db
    .select()
    .from(keyResults)
    .where(and(eq(keyResults.id, keyResultId), eq(keyResults.objectiveId, objectiveId)))
    .limit(1);
  if (!row) throw notFound('Key result not found');
  return row;
}

/** Ladder a whole project up to a key result so its completion drives progress. */
export async function linkKeyResultProject(
  db: Database,
  workspaceId: string,
  actor: Actor,
  objectiveId: string,
  keyResultId: string,
  projectId: string,
): Promise<void> {
  await loadKeyResultRow(db, workspaceId, objectiveId, keyResultId);
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  if (!project) throw notFound('Project not found');
  await db
    .insert(keyResultProjects)
    .values({
      keyResultId,
      projectId,
      createdByUserId: actor.type === 'user' ? actor.id : null,
    })
    .onConflictDoNothing({ target: [keyResultProjects.keyResultId, keyResultProjects.projectId] });
  await touchObjective(db, objectiveId);
  await audit(db, workspaceId, actor, 'objective.key_result_project_linked', objectiveId, {
    keyResultId,
    projectId,
  });
}

export async function unlinkKeyResultProject(
  db: Database,
  workspaceId: string,
  actor: Actor,
  objectiveId: string,
  keyResultId: string,
  projectId: string,
): Promise<void> {
  await loadKeyResultRow(db, workspaceId, objectiveId, keyResultId);
  await db
    .delete(keyResultProjects)
    .where(
      and(
        eq(keyResultProjects.keyResultId, keyResultId),
        eq(keyResultProjects.projectId, projectId),
      ),
    );
  await touchObjective(db, objectiveId);
  await audit(db, workspaceId, actor, 'objective.key_result_project_unlinked', objectiveId, {
    keyResultId,
    projectId,
  });
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
  await appendAuditEvent(db, {
    workspaceId,
    actorType: actor.type,
    actorId: actor.id,
    action,
    targetType: 'objective',
    targetId,
    payload,
  });
}
