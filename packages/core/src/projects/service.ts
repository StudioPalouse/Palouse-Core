import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import {
  decisionRelations,
  decisions,
  projectColumns,
  projectItemDependencies,
  projectItemTasks,
  projectItems,
  projects,
  tasks,
  type Database,
} from '@palouse/db';
import { appendAuditEvent } from '../audit/chain.js';
import { diffAuditChanges } from '../audit/changes.js';
import {
  conflict,
  notFound,
  validation,
  type Actor,
  type AddDependencyInput,
  type CreateColumnInput,
  type CreateProjectInput,
  type CreateProjectItemInput,
  type LinkedDecision,
  type LinkedTask,
  type ListProjectsQuery,
  type Project,
  type ProjectColumn,
  type ProjectDetail,
  type ProjectItem,
  type ProjectItemWithLinks,
  type ProjectListItem,
  type UpdateColumnInput,
  type UpdateProjectInput,
  type UpdateProjectItemInput,
} from '@palouse/shared';

/** Gap between fractional ranks so a row can be dropped between two others. */
const RANK_STEP = 1000;

function toDto(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    descriptionMd: row.descriptionMd,
    status: row.status,
    origin: row.origin,
    createdByUserId: row.createdByUserId,
    createdByAgentId: row.createdByAgentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function columnToDto(row: typeof projectColumns.$inferSelect): ProjectColumn {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    position: row.position,
    isDone: row.isDone,
    createdAt: row.createdAt.toISOString(),
  };
}

function itemToDto(row: typeof projectItems.$inferSelect): ProjectItem {
  return {
    id: row.id,
    projectId: row.projectId,
    columnId: row.columnId,
    title: row.title,
    descriptionMd: row.descriptionMd,
    position: row.position,
    completedAt: row.completedAt?.toISOString() ?? null,
    startDate: row.startDate?.toISOString() ?? null,
    endDate: row.endDate?.toISOString() ?? null,
    assigneeUserId: row.assigneeUserId,
    origin: row.origin,
    createdByUserId: row.createdByUserId,
    createdByAgentId: row.createdByAgentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadProjectRow(
  db: Database,
  workspaceId: string,
  projectId: string,
): Promise<typeof projects.$inferSelect> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw notFound('Project not found');
  return row;
}

async function loadItemRow(
  db: Database,
  projectId: string,
  itemId: string,
): Promise<typeof projectItems.$inferSelect> {
  const [row] = await db
    .select()
    .from(projectItems)
    .where(and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)))
    .limit(1);
  if (!row) throw notFound('Project item not found');
  return row;
}

async function loadColumnRow(
  db: Database,
  projectId: string,
  columnId: string,
): Promise<typeof projectColumns.$inferSelect> {
  const [row] = await db
    .select()
    .from(projectColumns)
    .where(and(eq(projectColumns.id, columnId), eq(projectColumns.projectId, projectId)))
    .limit(1);
  if (!row) throw notFound('Column not found');
  return row;
}

export async function listProjects(
  db: Database,
  query: ListProjectsQuery,
): Promise<{ projects: ProjectListItem[]; total: number }> {
  const conditions: SQL[] = [eq(projects.workspaceId, query.workspaceId)];
  if (query.status) conditions.push(eq(projects.status, query.status));
  if (query.search) conditions.push(ilike(projects.name, `%${query.search}%`));
  const where = and(...conditions);

  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(projects)
      .where(where)
      .orderBy(desc(projects.updatedAt))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(projects)
      .where(where),
  ]);

  // Count total and completed items per project on this page in one grouped
  // query (avoids a fan-out join).
  const ids = rows.map((r) => r.id);
  const counts = new Map<string, { itemCount: number; completedCount: number }>();
  for (const id of ids) counts.set(id, { itemCount: 0, completedCount: 0 });
  if (ids.length > 0) {
    const itemRows = await db
      .select({
        projectId: projectItems.projectId,
        itemCount: sql<number>`count(*)::int`,
        completedCount: sql<number>`count(${projectItems.completedAt})::int`,
      })
      .from(projectItems)
      .where(inArray(projectItems.projectId, ids))
      .groupBy(projectItems.projectId);
    for (const r of itemRows) {
      counts.set(r.projectId, { itemCount: r.itemCount, completedCount: r.completedCount });
    }
  }

  return {
    projects: rows.map((r) => {
      const c = counts.get(r.id)!;
      const progress = c.itemCount > 0 ? Math.round((c.completedCount / c.itemCount) * 100) : 0;
      return { ...toDto(r), itemCount: c.itemCount, completedCount: c.completedCount, progress };
    }),
    total: count?.total ?? 0,
  };
}

/**
 * Reverse lookup: decisions linked to this project as a whole
 * (`entityType = 'project'`), distinct from the card-level (`project_item`) links
 * returned per item. Workspace-scoped through the `decisions` join, which is
 * load-bearing since `decision_relations.entityId` is not a hard FK. Served by
 * `decision_relations_entity_idx`. Loaded on demand, not folded into the hot
 * board/Gantt query. Reused by Themes C and D.
 */
export async function listRelatedDecisions(
  db: Database,
  workspaceId: string,
  projectId: string,
): Promise<LinkedDecision[]> {
  return db
    .select({
      relationId: decisionRelations.id,
      decisionId: decisions.id,
      title: decisions.title,
      status: decisions.status,
    })
    .from(decisionRelations)
    .innerJoin(decisions, eq(decisions.id, decisionRelations.decisionId))
    .where(
      and(
        eq(decisions.workspaceId, workspaceId),
        eq(decisionRelations.entityType, 'project'),
        eq(decisionRelations.entityId, projectId),
      ),
    )
    .orderBy(desc(decisions.updatedAt));
}

export async function getProject(
  db: Database,
  workspaceId: string,
  projectId: string,
  options: { includeRelatedDecisions?: boolean } = {},
): Promise<ProjectDetail> {
  const row = await loadProjectRow(db, workspaceId, projectId);
  const [columnRows, itemRows, depRows] = await Promise.all([
    db
      .select()
      .from(projectColumns)
      .where(eq(projectColumns.projectId, projectId))
      .orderBy(asc(projectColumns.position)),
    db
      .select()
      .from(projectItems)
      .where(eq(projectItems.projectId, projectId))
      .orderBy(asc(projectItems.position)),
    db
      .select()
      .from(projectItemDependencies)
      .where(eq(projectItemDependencies.projectId, projectId)),
  ]);

  const itemIds = itemRows.map((i) => i.id);
  const taskLinks = new Map<string, LinkedTask[]>();
  const decisionLinks = new Map<string, LinkedDecision[]>();
  if (itemIds.length > 0) {
    const [taskRows, decisionRows] = await Promise.all([
      db
        .select({
          projectItemId: projectItemTasks.projectItemId,
          taskId: tasks.id,
          title: tasks.title,
          status: tasks.status,
        })
        .from(projectItemTasks)
        .innerJoin(tasks, eq(tasks.id, projectItemTasks.taskId))
        .where(inArray(projectItemTasks.projectItemId, itemIds)),
      db
        .select({
          relationId: decisionRelations.id,
          entityId: decisionRelations.entityId,
          decisionId: decisions.id,
          title: decisions.title,
          status: decisions.status,
        })
        .from(decisionRelations)
        .innerJoin(decisions, eq(decisions.id, decisionRelations.decisionId))
        .where(
          and(
            eq(decisionRelations.entityType, 'project_item'),
            inArray(decisionRelations.entityId, itemIds),
          ),
        ),
    ]);
    for (const t of taskRows) {
      const list = taskLinks.get(t.projectItemId) ?? [];
      list.push({ taskId: t.taskId, title: t.title, status: t.status });
      taskLinks.set(t.projectItemId, list);
    }
    for (const d of decisionRows) {
      const list = decisionLinks.get(d.entityId) ?? [];
      list.push({
        relationId: d.relationId,
        decisionId: d.decisionId,
        title: d.title,
        status: d.status,
      });
      decisionLinks.set(d.entityId, list);
    }
  }

  const predecessors = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  for (const dep of depRows) {
    const preds = predecessors.get(dep.successorItemId) ?? [];
    preds.push(dep.predecessorItemId);
    predecessors.set(dep.successorItemId, preds);
    const succs = successors.get(dep.predecessorItemId) ?? [];
    succs.push(dep.successorItemId);
    successors.set(dep.predecessorItemId, succs);
  }

  const items: ProjectItemWithLinks[] = itemRows.map((i) => ({
    ...itemToDto(i),
    linkedTasks: taskLinks.get(i.id) ?? [],
    linkedDecisions: decisionLinks.get(i.id) ?? [],
    predecessorItemIds: predecessors.get(i.id) ?? [],
    successorItemIds: successors.get(i.id) ?? [],
  }));

  // Gated by the caller: empty unless the decisions capability is on, so decision
  // titles never leak through the projects gate. Project-level links only; the
  // per-card links above are separate.
  const relatedDecisions = options.includeRelatedDecisions
    ? await listRelatedDecisions(db, workspaceId, projectId)
    : [];

  return {
    project: toDto(row),
    columns: columnRows.map(columnToDto),
    items,
    relatedDecisions,
    dependencies: depRows.map((d) => ({
      id: d.id,
      projectId: d.projectId,
      predecessorItemId: d.predecessorItemId,
      successorItemId: d.successorItemId,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}

export async function createProject(
  db: Database,
  workspaceId: string,
  actor: Actor,
  input: CreateProjectInput,
): Promise<Project> {
  const project = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values({
        workspaceId,
        name: input.name,
        descriptionMd: input.descriptionMd ?? null,
        ...(input.status ? { status: input.status } : {}),
        origin: actor.type,
        createdByUserId: actor.type === 'user' ? actor.id : null,
        createdByAgentId: actor.type === 'agent' ? actor.id : null,
      })
      .returning();
    // Seed a familiar Kanban board; the last column counts cards as complete.
    await tx.insert(projectColumns).values([
      { projectId: row!.id, name: 'To do', position: RANK_STEP, isDone: false },
      { projectId: row!.id, name: 'In progress', position: RANK_STEP * 2, isDone: false },
      { projectId: row!.id, name: 'Done', position: RANK_STEP * 3, isDone: true },
    ]);
    return row!;
  });
  await audit(db, workspaceId, actor, 'project.created', project.id);
  return toDto(project);
}

export async function updateProject(
  db: Database,
  workspaceId: string,
  actor: Actor,
  projectId: string,
  input: UpdateProjectInput,
): Promise<Project> {
  const existing = await loadProjectRow(db, workspaceId, projectId);
  const patch: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.descriptionMd !== undefined) patch.descriptionMd = input.descriptionMd;
  if (input.status !== undefined) patch.status = input.status;

  const [row] = await db
    .update(projects)
    .set(patch)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .returning();
  if (!row) throw notFound('Project not found');
  const changes = diffAuditChanges(toDto(existing), toDto(row), Object.keys(input));
  await audit(db, workspaceId, actor, 'project.updated', projectId, {
    fields: Object.keys(input),
    changes,
  });
  return toDto(row);
}

export async function deleteProject(
  db: Database,
  workspaceId: string,
  actor: Actor,
  projectId: string,
): Promise<void> {
  await loadProjectRow(db, workspaceId, projectId);
  await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));
  await audit(db, workspaceId, actor, 'project.deleted', projectId);
}

// --- Columns ---------------------------------------------------------------

export async function addColumn(
  db: Database,
  workspaceId: string,
  actor: Actor,
  projectId: string,
  input: CreateColumnInput,
): Promise<ProjectColumn> {
  await loadProjectRow(db, workspaceId, projectId);
  const position = input.position ?? (await nextColumnPosition(db, projectId));
  const [row] = await db
    .insert(projectColumns)
    .values({ projectId, name: input.name, position, isDone: input.isDone ?? false })
    .returning();
  await touchProject(db, projectId);
  await audit(db, workspaceId, actor, 'project.column_added', projectId, { columnId: row!.id });
  return columnToDto(row!);
}

export async function updateColumn(
  db: Database,
  workspaceId: string,
  actor: Actor,
  projectId: string,
  columnId: string,
  input: UpdateColumnInput,
): Promise<ProjectColumn> {
  await loadProjectRow(db, workspaceId, projectId);
  const existing = await loadColumnRow(db, projectId, columnId);
  const patch: Partial<typeof projectColumns.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.position !== undefined) patch.position = input.position;
  if (input.isDone !== undefined) patch.isDone = input.isDone;

  const [row] = await db
    .update(projectColumns)
    .set(patch)
    .where(and(eq(projectColumns.id, columnId), eq(projectColumns.projectId, projectId)))
    .returning();

  // When a column becomes (or stops being) a done column, re-sync the
  // completion of the cards sitting in it so the KR rollup stays honest.
  if (input.isDone !== undefined && input.isDone !== existing.isDone) {
    await db
      .update(projectItems)
      .set({ completedAt: input.isDone ? new Date() : null, updatedAt: new Date() })
      .where(eq(projectItems.columnId, columnId));
  }
  await touchProject(db, projectId);
  await audit(db, workspaceId, actor, 'project.column_updated', projectId, { columnId });
  return columnToDto(row!);
}

export async function removeColumn(
  db: Database,
  workspaceId: string,
  actor: Actor,
  projectId: string,
  columnId: string,
): Promise<void> {
  await loadProjectRow(db, workspaceId, projectId);
  await loadColumnRow(db, projectId, columnId);
  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectItems)
    .where(eq(projectItems.columnId, columnId));
  if ((counted?.count ?? 0) > 0)
    throw conflict("Move or delete this column's cards before deleting the column.");
  await db.delete(projectColumns).where(eq(projectColumns.id, columnId));
  await touchProject(db, projectId);
  await audit(db, workspaceId, actor, 'project.column_removed', projectId, { columnId });
}

async function nextColumnPosition(db: Database, projectId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${projectColumns.position})` })
    .from(projectColumns)
    .where(eq(projectColumns.projectId, projectId));
  return (row?.max ?? 0) + RANK_STEP;
}

async function nextItemPosition(db: Database, columnId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${projectItems.position})` })
    .from(projectItems)
    .where(eq(projectItems.columnId, columnId));
  return (row?.max ?? 0) + RANK_STEP;
}

// --- Items -----------------------------------------------------------------

export async function createProjectItem(
  db: Database,
  workspaceId: string,
  actor: Actor,
  projectId: string,
  input: CreateProjectItemInput,
): Promise<ProjectItem> {
  await loadProjectRow(db, workspaceId, projectId);
  const column = input.columnId
    ? await loadColumnRow(db, projectId, input.columnId)
    : await firstColumn(db, projectId);
  const position = input.position ?? (await nextItemPosition(db, column.id));
  const shouldComplete = input.completed ?? column.isDone;
  const [row] = await db
    .insert(projectItems)
    .values({
      projectId,
      columnId: column.id,
      title: input.title,
      descriptionMd: input.descriptionMd ?? null,
      position,
      completedAt: shouldComplete ? new Date() : null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      assigneeUserId: input.assigneeUserId ?? null,
      origin: actor.type,
      createdByUserId: actor.type === 'user' ? actor.id : null,
      createdByAgentId: actor.type === 'agent' ? actor.id : null,
    })
    .returning();
  await touchProject(db, projectId);
  await audit(db, workspaceId, actor, 'project.item_created', projectId, { itemId: row!.id });
  return itemToDto(row!);
}

export async function updateProjectItem(
  db: Database,
  workspaceId: string,
  actor: Actor,
  projectId: string,
  itemId: string,
  input: UpdateProjectItemInput,
): Promise<ProjectItem> {
  await loadProjectRow(db, workspaceId, projectId);
  const existing = await loadItemRow(db, projectId, itemId);

  // Resolve the target column (for a move) so we can key completion off it.
  const targetColumn =
    input.columnId && input.columnId !== existing.columnId
      ? await loadColumnRow(db, projectId, input.columnId)
      : null;

  const patch: Partial<typeof projectItems.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.descriptionMd !== undefined) patch.descriptionMd = input.descriptionMd;
  if (input.position !== undefined) patch.position = input.position;
  if (input.assigneeUserId !== undefined) patch.assigneeUserId = input.assigneeUserId;
  if (input.startDate !== undefined)
    patch.startDate = input.startDate ? new Date(input.startDate) : null;
  if (input.endDate !== undefined) patch.endDate = input.endDate ? new Date(input.endDate) : null;
  if (targetColumn) patch.columnId = targetColumn.id;

  // Completion source of truth: an explicit flag wins; otherwise a move into or
  // out of a done column decides; otherwise it is unchanged.
  let shouldComplete: boolean | null = null;
  if (input.completed !== undefined) shouldComplete = input.completed;
  else if (targetColumn) shouldComplete = targetColumn.isDone;
  if (shouldComplete !== null) {
    patch.completedAt = shouldComplete ? (existing.completedAt ?? new Date()) : null;
  }

  const [row] = await db
    .update(projectItems)
    .set(patch)
    .where(and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)))
    .returning();
  if (!row) throw notFound('Project item not found');
  await touchProject(db, projectId);
  await audit(db, workspaceId, actor, 'project.item_updated', projectId, {
    itemId,
    fields: Object.keys(input),
  });
  return itemToDto(row);
}

export async function removeProjectItem(
  db: Database,
  workspaceId: string,
  actor: Actor,
  projectId: string,
  itemId: string,
): Promise<void> {
  await loadProjectRow(db, workspaceId, projectId);
  const [row] = await db
    .delete(projectItems)
    .where(and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)))
    .returning({ id: projectItems.id });
  if (!row) throw notFound('Project item not found');
  await touchProject(db, projectId);
  await audit(db, workspaceId, actor, 'project.item_removed', projectId, { itemId });
}

async function firstColumn(
  db: Database,
  projectId: string,
): Promise<typeof projectColumns.$inferSelect> {
  const [row] = await db
    .select()
    .from(projectColumns)
    .where(eq(projectColumns.projectId, projectId))
    .orderBy(asc(projectColumns.position))
    .limit(1);
  if (!row) throw validation('This project has no columns to add a card to.');
  return row;
}

// --- Dependencies ----------------------------------------------------------

export async function addDependency(
  db: Database,
  workspaceId: string,
  actor: Actor,
  projectId: string,
  input: AddDependencyInput,
): Promise<void> {
  await loadProjectRow(db, workspaceId, projectId);
  if (input.predecessorItemId === input.successorItemId)
    throw validation('A card cannot depend on itself.');
  await loadItemRow(db, projectId, input.predecessorItemId);
  await loadItemRow(db, projectId, input.successorItemId);

  // Reject the direct reverse edge so we never create an obvious 2-cycle.
  const [reverse] = await db
    .select({ id: projectItemDependencies.id })
    .from(projectItemDependencies)
    .where(
      and(
        eq(projectItemDependencies.predecessorItemId, input.successorItemId),
        eq(projectItemDependencies.successorItemId, input.predecessorItemId),
      ),
    )
    .limit(1);
  if (reverse) throw conflict('The reverse dependency already exists.');

  await db
    .insert(projectItemDependencies)
    .values({
      projectId,
      predecessorItemId: input.predecessorItemId,
      successorItemId: input.successorItemId,
      createdByUserId: actor.type === 'user' ? actor.id : null,
    })
    .onConflictDoNothing({
      target: [projectItemDependencies.predecessorItemId, projectItemDependencies.successorItemId],
    });
  await touchProject(db, projectId);
  await audit(db, workspaceId, actor, 'project.dependency_added', projectId, {
    predecessorItemId: input.predecessorItemId,
    successorItemId: input.successorItemId,
  });
}

export async function removeDependency(
  db: Database,
  workspaceId: string,
  actor: Actor,
  projectId: string,
  dependencyId: string,
): Promise<void> {
  await loadProjectRow(db, workspaceId, projectId);
  const [row] = await db
    .delete(projectItemDependencies)
    .where(
      and(
        eq(projectItemDependencies.id, dependencyId),
        eq(projectItemDependencies.projectId, projectId),
      ),
    )
    .returning({ id: projectItemDependencies.id });
  if (!row) throw notFound('Dependency not found');
  await touchProject(db, projectId);
  await audit(db, workspaceId, actor, 'project.dependency_removed', projectId, { dependencyId });
}

// --- Task links ------------------------------------------------------------

export async function linkTask(
  db: Database,
  workspaceId: string,
  actor: Actor,
  projectId: string,
  itemId: string,
  taskId: string,
): Promise<void> {
  await loadProjectRow(db, workspaceId, projectId);
  await loadItemRow(db, projectId, itemId);
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!task) throw notFound('Task not found');
  await db
    .insert(projectItemTasks)
    .values({
      projectItemId: itemId,
      taskId,
      createdByUserId: actor.type === 'user' ? actor.id : null,
    })
    .onConflictDoNothing({ target: [projectItemTasks.projectItemId, projectItemTasks.taskId] });
  await touchProject(db, projectId);
  await audit(db, workspaceId, actor, 'project.task_linked', projectId, { itemId, taskId });
}

export async function unlinkTask(
  db: Database,
  workspaceId: string,
  actor: Actor,
  projectId: string,
  itemId: string,
  taskId: string,
): Promise<void> {
  await loadProjectRow(db, workspaceId, projectId);
  await loadItemRow(db, projectId, itemId);
  await db
    .delete(projectItemTasks)
    .where(and(eq(projectItemTasks.projectItemId, itemId), eq(projectItemTasks.taskId, taskId)));
  await touchProject(db, projectId);
  await audit(db, workspaceId, actor, 'project.task_unlinked', projectId, { itemId, taskId });
}

// --- Decision links --------------------------------------------------------

export async function linkDecision(
  db: Database,
  workspaceId: string,
  actor: Actor,
  projectId: string,
  itemId: string,
  decisionId: string,
): Promise<void> {
  await loadProjectRow(db, workspaceId, projectId);
  await loadItemRow(db, projectId, itemId);
  const [decision] = await db
    .select({ id: decisions.id })
    .from(decisions)
    .where(and(eq(decisions.id, decisionId), eq(decisions.workspaceId, workspaceId)))
    .limit(1);
  if (!decision) throw notFound('Decision not found');
  await db
    .insert(decisionRelations)
    .values({
      decisionId,
      entityType: 'project_item',
      entityId: itemId,
      createdByUserId: actor.type === 'user' ? actor.id : null,
    })
    .onConflictDoNothing({
      target: [
        decisionRelations.decisionId,
        decisionRelations.entityType,
        decisionRelations.entityId,
      ],
    });
  await touchProject(db, projectId);
  await audit(db, workspaceId, actor, 'project.decision_linked', projectId, { itemId, decisionId });
}

export async function unlinkDecision(
  db: Database,
  workspaceId: string,
  actor: Actor,
  projectId: string,
  itemId: string,
  decisionId: string,
): Promise<void> {
  await loadProjectRow(db, workspaceId, projectId);
  await loadItemRow(db, projectId, itemId);
  await db
    .delete(decisionRelations)
    .where(
      and(
        eq(decisionRelations.decisionId, decisionId),
        eq(decisionRelations.entityType, 'project_item'),
        eq(decisionRelations.entityId, itemId),
      ),
    );
  await touchProject(db, projectId);
  await audit(db, workspaceId, actor, 'project.decision_unlinked', projectId, {
    itemId,
    decisionId,
  });
}

/** Bump the project's updatedAt so list ordering reflects child edits. */
async function touchProject(db: Database, projectId: string): Promise<void> {
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
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
    targetType: 'project',
    targetId,
    payload,
  });
}
