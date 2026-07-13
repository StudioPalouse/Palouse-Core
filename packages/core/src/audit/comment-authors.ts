import { inArray } from 'drizzle-orm';
import { agents, users, type Database } from '@palouse/db';

/**
 * Resolve display names for a batch of comment rows so agent-authored comments
 * show the agent by name rather than being inferred from a null user (roadmap
 * A4). Returns a map keyed `user:<id>` / `agent:<id>`; a comment carries either
 * an `authorUserId` or an `authorAgentId`, never both. Users resolve to their
 * name (falling back to email), agents to their name.
 */
export interface CommentAuthorRow {
  authorUserId: string | null;
  authorAgentId: string | null;
}

export async function resolveCommentAuthors(
  db: Database,
  rows: CommentAuthorRow[],
): Promise<Map<string, string>> {
  const userIds = new Set<string>();
  const agentIds = new Set<string>();
  for (const r of rows) {
    if (r.authorUserId) userIds.add(r.authorUserId);
    else if (r.authorAgentId) agentIds.add(r.authorAgentId);
  }

  const names = new Map<string, string>();
  const lookups: Promise<void>[] = [];
  if (userIds.size)
    lookups.push(
      db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, [...userIds]))
        .then((us) => {
          for (const u of us) names.set(`user:${u.id}`, u.name ?? u.email);
        }),
    );
  if (agentIds.size)
    lookups.push(
      db
        .select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(inArray(agents.id, [...agentIds]))
        .then((ag) => {
          for (const a of ag) names.set(`agent:${a.id}`, a.name);
        }),
    );
  await Promise.all(lookups);
  return names;
}

/** The resolved name for one comment row, given the map from `resolveCommentAuthors`. */
export function commentAuthorName(
  row: CommentAuthorRow,
  names: Map<string, string>,
): string | null {
  if (row.authorUserId) return names.get(`user:${row.authorUserId}`) ?? null;
  if (row.authorAgentId) return names.get(`agent:${row.authorAgentId}`) ?? null;
  return null;
}
