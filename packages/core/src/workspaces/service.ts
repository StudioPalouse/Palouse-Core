import { and, eq, isNull } from 'drizzle-orm';
import {
  memberships,
  organizations,
  workspaces,
  type Database,
} from '@palouse/db';
import {
  conflict,
  forbidden,
  type CreateWorkspaceInput,
  type MemberRole,
  type Workspace,
} from '@palouse/shared';

function toDto(
  ws: typeof workspaces.$inferSelect,
  role: MemberRole,
): Workspace {
  return {
    id: ws.id,
    organizationId: ws.organizationId,
    name: ws.name,
    slug: ws.slug,
    role,
    createdAt: ws.createdAt.toISOString(),
  };
}

/** Workspaces the user belongs to, with their membership role. */
export async function listWorkspacesForUser(db: Database, userId: string): Promise<Workspace[]> {
  const rows = await db
    .select({ workspace: workspaces, role: memberships.role })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(eq(memberships.userId, userId))
    .orderBy(workspaces.createdAt);
  return rows.map((r) => toDto(r.workspace, r.role));
}

/**
 * v1 keeps a 1:1 org:workspace shape — creating a workspace creates a backing
 * organization with the same name/slug. Multi-workspace orgs come later.
 */
export async function createWorkspace(
  db: Database,
  userId: string,
  input: CreateWorkspaceInput,
): Promise<Workspace> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, input.slug))
      .limit(1);
    if (existing.length > 0) throw conflict(`Slug "${input.slug}" is already taken`);

    const [org] = await tx
      .insert(organizations)
      .values({ name: input.name, slug: input.slug })
      .returning();
    const [ws] = await tx
      .insert(workspaces)
      .values({ organizationId: org!.id, name: input.name, slug: input.slug })
      .returning();
    await tx.insert(memberships).values({
      workspaceId: ws!.id,
      userId,
      role: 'owner',
    });
    return toDto(ws!, 'owner');
  });
}

/** Throws FORBIDDEN unless the user is a member of the workspace. Returns their role. */
export async function requireMembership(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<MemberRole> {
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);
  if (rows.length === 0) throw forbidden('Not a member of this workspace');
  return rows[0]!.role;
}
