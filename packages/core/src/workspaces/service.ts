import { createHash, randomBytes } from 'node:crypto';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import {
  invitations,
  memberships,
  organizations,
  users,
  workspaces,
  type Database,
} from '@palouse/db';
import {
  conflict,
  forbidden,
  notFound,
  type CreateInviteInput,
  type CreateWorkspaceInput,
  type Invitation,
  type MemberRole,
  type Workspace,
  type WorkspaceMember,
} from '@palouse/shared';

const ADMIN_ROLES: MemberRole[] = ['owner', 'admin'];

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

/** Throws FORBIDDEN unless the user's role is one of `allowed`. Returns their role. */
export async function requireRole(
  db: Database,
  workspaceId: string,
  userId: string,
  allowed: MemberRole[],
): Promise<MemberRole> {
  const role = await requireMembership(db, workspaceId, userId);
  if (!allowed.includes(role)) throw forbidden('Your role does not allow this action');
  return role;
}

function memberToDto(r: {
  userId: string;
  email: string;
  name: string | null;
  role: MemberRole;
  joinedAt: Date;
}): WorkspaceMember {
  return {
    userId: r.userId,
    email: r.email,
    name: r.name,
    role: r.role,
    joinedAt: r.joinedAt.toISOString(),
  };
}

/** All members of a workspace with their user info and role. */
export async function listMembers(db: Database, workspaceId: string): Promise<WorkspaceMember[]> {
  const rows = await db
    .select({
      userId: memberships.userId,
      email: users.email,
      name: users.name,
      role: memberships.role,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.workspaceId, workspaceId))
    .orderBy(memberships.createdAt);
  return rows.map(memberToDto);
}

async function getMember(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMember | null> {
  const rows = await db
    .select({
      userId: memberships.userId,
      email: users.email,
      name: users.name,
      role: memberships.role,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);
  return rows[0] ? memberToDto(rows[0]) : null;
}

async function ownerCount(db: Database, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.role, 'owner')));
  return Number(row?.n ?? 0);
}

/** Change a member's role. Requires actor to be owner/admin; keeps at least one owner. */
export async function updateMemberRole(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  targetUserId: string,
  role: MemberRole,
): Promise<WorkspaceMember> {
  await requireRole(db, workspaceId, actorUserId, ADMIN_ROLES);
  const current = await getMember(db, workspaceId, targetUserId);
  if (!current) throw notFound('Member not found');
  if (current.role === 'owner' && role !== 'owner' && (await ownerCount(db, workspaceId)) <= 1) {
    throw conflict('A workspace must keep at least one owner');
  }
  await db
    .update(memberships)
    .set({ role, updatedAt: new Date() })
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, targetUserId)));
  return { ...current, role };
}

/** Remove a member. Requires actor to be owner/admin; cannot remove the last owner. */
export async function removeMember(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  targetUserId: string,
): Promise<void> {
  await requireRole(db, workspaceId, actorUserId, ADMIN_ROLES);
  const current = await getMember(db, workspaceId, targetUserId);
  if (!current) throw notFound('Member not found');
  if (current.role === 'owner' && (await ownerCount(db, workspaceId)) <= 1) {
    throw conflict('A workspace must keep at least one owner');
  }
  await db
    .delete(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, targetUserId)));
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

const INVITE_TTL_DAYS = 7;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function inviteToDto(row: typeof invitations.$inferSelect): Invitation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role,
    status: row.status,
    invitedByUserId: row.invitedByUserId,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Create a pending invitation and return the raw token (emailed once, stored
 * only as a hash). Requires the actor to be owner/admin.
 */
export async function createInvite(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  input: CreateInviteInput,
): Promise<{ invitation: Invitation; token: string }> {
  await requireRole(db, workspaceId, actorUserId, ADMIN_ROLES);

  const alreadyMember = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(users.email, input.email)))
    .limit(1);
  if (alreadyMember.length > 0) throw conflict('That person is already a member');

  // A fresh invite supersedes any outstanding one for the same email.
  await db
    .update(invitations)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(
      and(
        eq(invitations.workspaceId, workspaceId),
        eq(invitations.email, input.email),
        eq(invitations.status, 'pending'),
      ),
    );

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  const [row] = await db
    .insert(invitations)
    .values({
      workspaceId,
      email: input.email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedByUserId: actorUserId,
      expiresAt,
    })
    .returning();
  return { invitation: inviteToDto(row!), token };
}

/** Pending invitations for a workspace. */
export async function listInvites(db: Database, workspaceId: string): Promise<Invitation[]> {
  const rows = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.status, 'pending')))
    .orderBy(desc(invitations.createdAt));
  return rows.map(inviteToDto);
}

/** Revoke a pending invitation. Requires owner/admin. */
export async function revokeInvite(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  inviteId: string,
): Promise<void> {
  await requireRole(db, workspaceId, actorUserId, ADMIN_ROLES);
  const rows = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.id, inviteId), eq(invitations.workspaceId, workspaceId)))
    .limit(1);
  if (rows.length === 0) throw notFound('Invitation not found');
  await db
    .update(invitations)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(eq(invitations.id, inviteId));
}

/**
 * Accept an invitation for the signed-in user: creates the membership (if not
 * already present) and marks the invite accepted. Returns the workspace id.
 */
export async function acceptInvite(
  db: Database,
  userId: string,
  token: string,
): Promise<{ workspaceId: string }> {
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.tokenHash, hashToken(token)), eq(invitations.status, 'pending')))
      .limit(1);
    if (!invite) throw notFound('This invitation is invalid or has already been used');
    if (invite.expiresAt.getTime() < Date.now()) {
      await tx
        .update(invitations)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(invitations.id, invite.id));
      throw conflict('This invitation has expired');
    }

    const existing = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, invite.workspaceId), eq(memberships.userId, userId)))
      .limit(1);
    if (existing.length === 0) {
      await tx
        .insert(memberships)
        .values({ workspaceId: invite.workspaceId, userId, role: invite.role });
    }

    await tx
      .update(invitations)
      .set({ status: 'accepted', acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(invitations.id, invite.id));

    return { workspaceId: invite.workspaceId };
  });
}
