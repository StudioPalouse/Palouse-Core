import { and, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import {
  auditEvents,
  decisionComments,
  decisionRelations,
  decisionResources,
  decisionStakeholders,
  decisions,
  type Database,
} from '@palouse/db';
import {
  notFound,
  validation,
  type Actor,
  type AddRelationInput,
  type AddResourceInput,
  type CreateDecisionCommentInput,
  type CreateDecisionInput,
  type Decision,
  type DecisionComment,
  type DecisionDetail,
  type DecisionListItem,
  type DecisionRelation,
  type DecisionResource,
  type DecisionStakeholder,
  type ListDecisionsQuery,
  type SetStakeholdersInput,
  type UpdateDecisionInput,
} from '@palouse/shared';

function toDto(row: typeof decisions.$inferSelect): Decision {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    descriptionMd: row.descriptionMd,
    area: row.area,
    status: row.status,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    supersededByDecisionId: row.supersededByDecisionId,
    origin: row.origin,
    createdByUserId: row.createdByUserId,
    createdByAgentId: row.createdByAgentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function stakeholderToDto(row: typeof decisionStakeholders.$inferSelect): DecisionStakeholder {
  return {
    id: row.id,
    decisionId: row.decisionId,
    userId: row.userId,
    role: row.role,
    assignedByUserId: row.assignedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function commentToDto(row: typeof decisionComments.$inferSelect): DecisionComment {
  return {
    id: row.id,
    decisionId: row.decisionId,
    authorUserId: row.authorUserId,
    bodyMd: row.bodyMd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function resourceToDto(row: typeof decisionResources.$inferSelect): DecisionResource {
  return {
    id: row.id,
    decisionId: row.decisionId,
    label: row.label,
    url: row.url,
    kind: row.kind,
    addedByUserId: row.addedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function relationToDto(row: typeof decisionRelations.$inferSelect): DecisionRelation {
  return {
    id: row.id,
    decisionId: row.decisionId,
    entityType: row.entityType,
    entityId: row.entityId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** At most one Accountable across a RACI roster. Throws VALIDATION otherwise. */
function assertSingleAccountable(stakeholders: { role: string }[]): void {
  const accountable = stakeholders.filter((s) => s.role === 'accountable').length;
  if (accountable > 1) {
    throw validation('A decision can have at most one Accountable stakeholder (RACI).');
  }
}

export async function listDecisions(
  db: Database,
  query: ListDecisionsQuery,
): Promise<{ decisions: DecisionListItem[]; total: number }> {
  const conditions: SQL[] = [eq(decisions.workspaceId, query.workspaceId)];
  if (query.status) conditions.push(eq(decisions.status, query.status));
  if (query.area) conditions.push(ilike(decisions.area, `%${query.area}%`));
  if (query.search) conditions.push(ilike(decisions.title, `%${query.search}%`));
  const where = and(...conditions);

  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(decisions)
      .where(where)
      .orderBy(desc(decisions.updatedAt))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(decisions)
      .where(where),
  ]);

  // Enrich each row with lightweight counts, fetched in one grouped query per
  // child table keyed by this page's decision ids (avoids fan-out joins).
  const ids = rows.map((r) => r.id);
  const counts = new Map<string, { stakeholders: number; relations: number; comments: number }>();
  for (const id of ids) counts.set(id, { stakeholders: 0, relations: 0, comments: 0 });
  if (ids.length > 0) {
    const [stakeholderCounts, relationCounts, commentCounts] = await Promise.all([
      db
        .select({ id: decisionStakeholders.decisionId, n: sql<number>`count(*)::int` })
        .from(decisionStakeholders)
        .where(inArray(decisionStakeholders.decisionId, ids))
        .groupBy(decisionStakeholders.decisionId),
      db
        .select({ id: decisionRelations.decisionId, n: sql<number>`count(*)::int` })
        .from(decisionRelations)
        .where(inArray(decisionRelations.decisionId, ids))
        .groupBy(decisionRelations.decisionId),
      db
        .select({ id: decisionComments.decisionId, n: sql<number>`count(*)::int` })
        .from(decisionComments)
        .where(inArray(decisionComments.decisionId, ids))
        .groupBy(decisionComments.decisionId),
    ]);
    for (const c of stakeholderCounts) counts.get(c.id)!.stakeholders = c.n;
    for (const c of relationCounts) counts.get(c.id)!.relations = c.n;
    for (const c of commentCounts) counts.get(c.id)!.comments = c.n;
  }

  return {
    decisions: rows.map((r) => {
      const c = counts.get(r.id)!;
      return {
        ...toDto(r),
        stakeholderCount: c.stakeholders,
        relationCount: c.relations,
        commentCount: c.comments,
      };
    }),
    total: count?.total ?? 0,
  };
}

async function loadDecisionRow(
  db: Database,
  workspaceId: string,
  decisionId: string,
): Promise<typeof decisions.$inferSelect> {
  const [row] = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.id, decisionId), eq(decisions.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw notFound('Decision not found');
  return row;
}

export async function getDecision(
  db: Database,
  workspaceId: string,
  decisionId: string,
): Promise<DecisionDetail> {
  const row = await loadDecisionRow(db, workspaceId, decisionId);
  const [stakeholders, comments, resources, relations] = await Promise.all([
    db
      .select()
      .from(decisionStakeholders)
      .where(eq(decisionStakeholders.decisionId, decisionId))
      .orderBy(decisionStakeholders.createdAt),
    db
      .select()
      .from(decisionComments)
      .where(eq(decisionComments.decisionId, decisionId))
      .orderBy(decisionComments.createdAt),
    db
      .select()
      .from(decisionResources)
      .where(eq(decisionResources.decisionId, decisionId))
      .orderBy(decisionResources.createdAt),
    db
      .select()
      .from(decisionRelations)
      .where(eq(decisionRelations.decisionId, decisionId))
      .orderBy(decisionRelations.createdAt),
  ]);
  return {
    decision: toDto(row),
    stakeholders: stakeholders.map(stakeholderToDto),
    comments: comments.map(commentToDto),
    resources: resources.map(resourceToDto),
    relations: relations.map(relationToDto),
  };
}

export async function createDecision(
  db: Database,
  workspaceId: string,
  actor: Actor,
  input: CreateDecisionInput,
): Promise<Decision> {
  if (input.stakeholders) assertSingleAccountable(input.stakeholders);

  const decision = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(decisions)
      .values({
        workspaceId,
        title: input.title,
        descriptionMd: input.descriptionMd ?? null,
        area: input.area ?? null,
        // Omit status when unset so the DB default ('proposed') applies.
        ...(input.status ? { status: input.status } : {}),
        origin: actor.type,
        createdByUserId: actor.type === 'user' ? actor.id : null,
        createdByAgentId: actor.type === 'agent' ? actor.id : null,
      })
      .returning();

    if (input.stakeholders?.length) {
      await tx.insert(decisionStakeholders).values(
        input.stakeholders.map((s) => ({
          decisionId: row!.id,
          userId: s.userId,
          role: s.role,
          assignedByUserId: actor.type === 'user' ? actor.id : null,
        })),
      );
    }
    if (input.relations?.length) {
      await tx.insert(decisionRelations).values(
        input.relations.map((r) => ({
          decisionId: row!.id,
          entityType: r.entityType,
          entityId: r.entityId,
          createdByUserId: actor.type === 'user' ? actor.id : null,
        })),
      );
    }
    return row!;
  });

  await audit(db, workspaceId, actor, 'decision.created', decision.id);
  return toDto(decision);
}

export async function updateDecision(
  db: Database,
  workspaceId: string,
  actor: Actor,
  decisionId: string,
  input: UpdateDecisionInput,
): Promise<Decision> {
  const existing = await loadDecisionRow(db, workspaceId, decisionId);

  const patch: Partial<typeof decisions.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.descriptionMd !== undefined) patch.descriptionMd = input.descriptionMd;
  if (input.area !== undefined) patch.area = input.area;
  if (input.supersededByDecisionId !== undefined)
    patch.supersededByDecisionId = input.supersededByDecisionId;

  if (input.status !== undefined) {
    patch.status = input.status;
    // A decision must have exactly one Accountable before it can be accepted.
    if (input.status === 'accepted' && existing.status !== 'accepted') {
      const [accountable] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(decisionStakeholders)
        .where(
          and(
            eq(decisionStakeholders.decisionId, decisionId),
            eq(decisionStakeholders.role, 'accountable'),
          ),
        );
      if ((accountable?.n ?? 0) !== 1) {
        throw validation(
          'A decision needs exactly one Accountable stakeholder before it can be accepted.',
        );
      }
    }
    // Stamp the decided date the first time it reaches a terminal outcome.
    if (
      (input.status === 'accepted' || input.status === 'rejected') &&
      existing.decidedAt === null
    ) {
      patch.decidedAt = new Date();
    }
  }

  const [row] = await db
    .update(decisions)
    .set(patch)
    .where(and(eq(decisions.id, decisionId), eq(decisions.workspaceId, workspaceId)))
    .returning();
  if (!row) throw notFound('Decision not found');
  await audit(db, workspaceId, actor, 'decision.updated', decisionId, {
    fields: Object.keys(input),
  });
  return toDto(row);
}

export async function setStakeholders(
  db: Database,
  workspaceId: string,
  actor: Actor,
  decisionId: string,
  input: SetStakeholdersInput,
): Promise<DecisionStakeholder[]> {
  await loadDecisionRow(db, workspaceId, decisionId);
  assertSingleAccountable(input.stakeholders);

  const rows = await db.transaction(async (tx) => {
    await tx.delete(decisionStakeholders).where(eq(decisionStakeholders.decisionId, decisionId));
    if (input.stakeholders.length === 0) return [];
    return tx
      .insert(decisionStakeholders)
      .values(
        input.stakeholders.map((s) => ({
          decisionId,
          userId: s.userId,
          role: s.role,
          assignedByUserId: actor.type === 'user' ? actor.id : null,
        })),
      )
      .returning();
  });

  await audit(db, workspaceId, actor, 'decision.stakeholders_set', decisionId, {
    count: input.stakeholders.length,
  });
  return rows.map(stakeholderToDto);
}

export async function addComment(
  db: Database,
  workspaceId: string,
  actor: Actor,
  decisionId: string,
  input: CreateDecisionCommentInput,
): Promise<DecisionComment> {
  await loadDecisionRow(db, workspaceId, decisionId);
  // Comments have a user author column only; agent comments keep it null and
  // are attributed via the audit trail.
  const [row] = await db
    .insert(decisionComments)
    .values({
      decisionId,
      authorUserId: actor.type === 'user' ? actor.id : null,
      bodyMd: input.bodyMd,
    })
    .returning();
  await audit(db, workspaceId, actor, 'decision.commented', decisionId);
  return commentToDto(row!);
}

export async function addResource(
  db: Database,
  workspaceId: string,
  actor: Actor,
  decisionId: string,
  input: AddResourceInput,
): Promise<DecisionResource> {
  await loadDecisionRow(db, workspaceId, decisionId);
  const [row] = await db
    .insert(decisionResources)
    .values({
      decisionId,
      label: input.label,
      url: input.url,
      kind: input.kind,
      addedByUserId: actor.type === 'user' ? actor.id : null,
    })
    .returning();
  await audit(db, workspaceId, actor, 'decision.resource_added', decisionId);
  return resourceToDto(row!);
}

export async function removeResource(
  db: Database,
  workspaceId: string,
  actor: Actor,
  decisionId: string,
  resourceId: string,
): Promise<void> {
  await loadDecisionRow(db, workspaceId, decisionId);
  const [row] = await db
    .delete(decisionResources)
    .where(and(eq(decisionResources.id, resourceId), eq(decisionResources.decisionId, decisionId)))
    .returning({ id: decisionResources.id });
  if (!row) throw notFound('Resource not found');
  await audit(db, workspaceId, actor, 'decision.resource_removed', decisionId);
}

export async function addRelation(
  db: Database,
  workspaceId: string,
  actor: Actor,
  decisionId: string,
  input: AddRelationInput,
): Promise<DecisionRelation> {
  await loadDecisionRow(db, workspaceId, decisionId);
  const [row] = await db
    .insert(decisionRelations)
    .values({
      decisionId,
      entityType: input.entityType,
      entityId: input.entityId,
      createdByUserId: actor.type === 'user' ? actor.id : null,
    })
    .onConflictDoNothing({
      target: [
        decisionRelations.decisionId,
        decisionRelations.entityType,
        decisionRelations.entityId,
      ],
    })
    .returning();
  // onConflictDoNothing yields no row when the relation already exists; return
  // the existing one so the call is idempotent.
  if (!row) {
    const [existing] = await db
      .select()
      .from(decisionRelations)
      .where(
        and(
          eq(decisionRelations.decisionId, decisionId),
          eq(decisionRelations.entityType, input.entityType),
          eq(decisionRelations.entityId, input.entityId),
        ),
      )
      .limit(1);
    return relationToDto(existing!);
  }
  await audit(db, workspaceId, actor, 'decision.relation_added', decisionId, {
    entityType: input.entityType,
    entityId: input.entityId,
  });
  return relationToDto(row);
}

export async function removeRelation(
  db: Database,
  workspaceId: string,
  actor: Actor,
  decisionId: string,
  relationId: string,
): Promise<void> {
  await loadDecisionRow(db, workspaceId, decisionId);
  const [row] = await db
    .delete(decisionRelations)
    .where(and(eq(decisionRelations.id, relationId), eq(decisionRelations.decisionId, decisionId)))
    .returning({ id: decisionRelations.id });
  if (!row) throw notFound('Relation not found');
  await audit(db, workspaceId, actor, 'decision.relation_removed', decisionId);
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
    targetType: 'decision',
    targetId,
    payload,
  });
}
