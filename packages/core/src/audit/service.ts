import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  agents,
  auditEvents,
  decisions,
  objectives,
  projects,
  tasks,
  users,
  type Database,
} from '@palouse/db';
import type {
  AuditEventListItem,
  AuditEventListResult,
  ListAuditEventsQuery,
} from '@palouse/shared';

type AuditRow = typeof auditEvents.$inferSelect;

/**
 * Read the workspace activity feed back out of the audit spine. Newest first,
 * paginated, with optional facets. The redundant `mcp.*` tool-call rows are
 * hidden unless `includeReads` is set (see docs/plans/agent-visibility-
 * implementation.md, the slice-1 mcp.* redundancy decision). Rows are enriched
 * with a resolved actor name, target label, and a plain-English summary.
 */
export async function listEvents(
  db: Database,
  query: ListAuditEventsQuery,
): Promise<AuditEventListResult> {
  const conditions: SQL[] = [eq(auditEvents.workspaceId, query.workspaceId)];
  if (query.action) conditions.push(eq(auditEvents.action, query.action));
  if (query.actorType) conditions.push(eq(auditEvents.actorType, query.actorType));
  if (query.targetType) conditions.push(eq(auditEvents.targetType, query.targetType));
  if (query.from) conditions.push(gte(auditEvents.at, new Date(query.from)));
  if (query.to) conditions.push(lte(auditEvents.at, new Date(query.to)));
  if (!query.includeReads) conditions.push(sql`${auditEvents.action} not like 'mcp.%'`);
  if (query.search) {
    const like = `%${query.search}%`;
    conditions.push(
      or(ilike(auditEvents.action, like), sql`cast(${auditEvents.payload} as text) ilike ${like}`)!,
    );
  }
  const where = and(...conditions);

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.at))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(where),
  ]);

  const events = await enrich(db, rows);
  return { events, total: countRows[0]?.total ?? 0 };
}

// --- enrichment -----------------------------------------------------------

/** Label column per target entity, for resolving `targetId` to a name. */
const TARGET_LOADERS: Record<
  string,
  (db: Database, ids: string[]) => Promise<Array<[string, string]>>
> = {
  task: (db, ids) =>
    db
      .select({ id: tasks.id, label: tasks.title })
      .from(tasks)
      .where(inArray(tasks.id, ids))
      .then((r) => r.map((x) => [x.id, x.label] as [string, string])),
  decision: (db, ids) =>
    db
      .select({ id: decisions.id, label: decisions.title })
      .from(decisions)
      .where(inArray(decisions.id, ids))
      .then((r) => r.map((x) => [x.id, x.label] as [string, string])),
  objective: (db, ids) =>
    db
      .select({ id: objectives.id, label: objectives.title })
      .from(objectives)
      .where(inArray(objectives.id, ids))
      .then((r) => r.map((x) => [x.id, x.label] as [string, string])),
  project: (db, ids) =>
    db
      .select({ id: projects.id, label: projects.name })
      .from(projects)
      .where(inArray(projects.id, ids))
      .then((r) => r.map((x) => [x.id, x.label] as [string, string])),
  agent: (db, ids) =>
    db
      .select({ id: agents.id, label: agents.name })
      .from(agents)
      .where(inArray(agents.id, ids))
      .then((r) => r.map((x) => [x.id, x.label] as [string, string])),
};

async function enrich(db: Database, rows: AuditRow[]): Promise<AuditEventListItem[]> {
  // Resolve actor display names (users by name/email, agents by name).
  const userIds = new Set<string>();
  const agentIds = new Set<string>();
  for (const r of rows) {
    if (!r.actorId) continue;
    if (r.actorType === 'user') userIds.add(r.actorId);
    else if (r.actorType === 'agent') agentIds.add(r.actorId);
  }
  const actorNames = new Map<string, string>();
  const lookups: Promise<void>[] = [];
  if (userIds.size)
    lookups.push(
      db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, [...userIds]))
        .then((us) => {
          for (const u of us) actorNames.set(`user:${u.id}`, u.name ?? u.email);
        }),
    );
  if (agentIds.size)
    lookups.push(
      db
        .select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(inArray(agents.id, [...agentIds]))
        .then((ag) => {
          for (const a of ag) actorNames.set(`agent:${a.id}`, a.name);
        }),
    );

  // Resolve target labels, grouped by target type so each table is hit once.
  const idsByType = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.targetType || !r.targetId) continue;
    (idsByType.get(r.targetType) ?? idsByType.set(r.targetType, new Set()).get(r.targetType)!).add(
      r.targetId,
    );
  }
  const targetLabels = new Map<string, string>();
  for (const [type, ids] of idsByType) {
    const loader = TARGET_LOADERS[type];
    if (!loader) continue;
    lookups.push(
      loader(db, [...ids]).then((found) => {
        for (const [id, label] of found) targetLabels.set(`${type}:${id}`, label);
      }),
    );
  }

  await Promise.all(lookups);

  return rows.map((r) => {
    const actorName = r.actorId ? (actorNames.get(`${r.actorType}:${r.actorId}`) ?? null) : null;
    const targetLabel =
      r.targetType && r.targetId
        ? (targetLabels.get(`${r.targetType}:${r.targetId}`) ?? null)
        : null;
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      action: r.action,
      actorType: r.actorType,
      actorId: r.actorId,
      actorName,
      targetType: r.targetType,
      targetId: r.targetId,
      targetLabel,
      summary: summarize(r.action, actorName, r.actorType, targetLabel, r.targetType, payload),
      payload,
      at: r.at.toISOString(),
    };
  });
}

// --- plain-English rendering ----------------------------------------------

const TARGET_NOUNS: Record<string, string> = {
  task: 'task',
  decision: 'decision',
  objective: 'objective',
  project: 'project',
  agent: 'agent',
  handoff: 'handoff',
};

function actorLabel(actorName: string | null, actorType: string): string {
  if (actorName) return actorName;
  return actorType === 'agent' ? 'An agent' : 'Someone';
}

function targetPhrase(targetType: string | null, targetLabel: string | null): string {
  if (!targetType) return '';
  const noun = TARGET_NOUNS[targetType] ?? targetType;
  return targetLabel ? `${noun} "${targetLabel}"` : `a ${noun}`;
}

function fieldsList(payload: Record<string, unknown>): string | null {
  const f = payload.fields;
  if (Array.isArray(f) && f.length) return f.map(String).join(', ');
  return null;
}

/**
 * Map an audit action to a business-readable sentence. Data-driven and easy to
 * extend; unknown actions fall back to a generic phrasing. No em-dashes.
 */
export function summarize(
  action: string,
  actorName: string | null,
  actorType: string,
  targetLabel: string | null,
  targetType: string | null,
  payload: Record<string, unknown>,
): string {
  const who = actorLabel(actorName, actorType);
  const what = targetPhrase(targetType, targetLabel);
  const fields = fieldsList(payload);
  const updated = fields ? `${who} updated ${fields} on ${what}` : `${who} updated ${what}`;
  switch (action) {
    case 'task.created':
      return `${who} created ${what}`;
    case 'task.updated':
      return updated;
    case 'task.commented':
      return `${who} commented on ${what}`;
    case 'decision.created':
      return `${who} logged ${what}`;
    case 'decision.updated':
      return updated;
    case 'decision.stakeholders_set':
      return `${who} set stakeholders on ${what}`;
    case 'decision.commented':
      return `${who} commented on ${what}`;
    case 'objective.created':
      return `${who} created ${what}`;
    case 'objective.updated':
      return updated;
    case 'objective.key_result_added':
      return `${who} added a key result to ${what}`;
    case 'project.created':
      return `${who} created ${what}`;
    case 'project.updated':
      return updated;
    case 'project.deleted':
      return `${who} deleted ${what}`;
    case 'project.column_added':
      return `${who} added a column to ${what}`;
    case 'project.item_created':
      return `${who} added an item to ${what}`;
    case 'project.item_updated':
      return `${who} updated an item on ${what}`;
    case 'agent.created':
      return `${who} connected ${what}`;
    case 'agent.archived':
      return `${who} archived ${what}`;
    case 'agent.unarchived':
      return `${who} restored ${what}`;
    case 'agent.deleted':
      return `${who} deleted ${what}`;
    case 'agent.key_created':
      return `${who} minted a key for ${what}`;
    case 'agent.key_revoked':
      return `${who} revoked a key for ${what}`;
    default: {
      const verb = action.includes('.')
        ? action.slice(action.indexOf('.') + 1).replace(/_/g, ' ')
        : action;
      return what ? `${who} ${verb} ${what}` : `${who} ${verb}`;
    }
  }
}
