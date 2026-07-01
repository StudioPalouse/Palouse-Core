import { createHash, randomBytes } from 'node:crypto';
import { and, count, desc, eq, gt, isNull } from 'drizzle-orm';
import {
  workspaceDeletionTokens,
  invitations,
  memberships,
  organizations,
  usageRollupsDaily,
  users,
  workspaces,
  type Database,
} from '@palouse/db';
import {
  conflict,
  forbidden,
  notFound,
  validation,
  type CreateInviteInput,
  type CreateWorkspaceInput,
  type Invitation,
  type MemberRole,
  type MembershipStatus,
  type Workspace,
  type WorkspaceMember,
} from '@palouse/shared';

const ADMIN_ROLES: MemberRole[] = ['owner', 'admin'];
const OWNER_ROLES: MemberRole[] = ['owner'];

function toDto(ws: typeof workspaces.$inferSelect, role: MemberRole): Workspace {
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
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')))
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
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        eq(memberships.userId, userId),
        eq(memberships.status, 'active'),
      ),
    )
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
  status: MembershipStatus;
  joinedAt: Date;
}): WorkspaceMember {
  return {
    userId: r.userId,
    email: r.email,
    name: r.name,
    role: r.role,
    status: r.status,
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
      status: memberships.status,
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
      status: memberships.status,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);
  return rows[0] ? memberToDto(rows[0]) : null;
}

/** Active owners only: a deactivated owner cannot be the one keeping a workspace alive. */
async function activeOwnerCount(db: Database, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        eq(memberships.role, 'owner'),
        eq(memberships.status, 'active'),
      ),
    );
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
  if (
    current.role === 'owner' &&
    role !== 'owner' &&
    (await activeOwnerCount(db, workspaceId)) <= 1
  ) {
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
  if (current.role === 'owner' && (await activeOwnerCount(db, workspaceId)) <= 1) {
    throw conflict('A workspace must keep at least one owner');
  }
  await db
    .delete(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, targetUserId)));
}

/**
 * Deactivate or reactivate a member. Deactivating keeps the membership row (so
 * their work stays attributable) but blocks access: `requireMembership` only
 * matches active members, so it takes effect on the deactivated user's next
 * request without touching their sessions (which are global and may cover other
 * workspaces they still belong to). Cannot deactivate the last active owner,
 * which also stops an admin from locking themselves out as the sole owner.
 */
export async function setMemberStatus(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  targetUserId: string,
  status: MembershipStatus,
): Promise<WorkspaceMember> {
  await requireRole(db, workspaceId, actorUserId, ADMIN_ROLES);
  const current = await getMember(db, workspaceId, targetUserId);
  if (!current) throw notFound('Member not found');

  if (
    status === 'inactive' &&
    current.role === 'owner' &&
    (await activeOwnerCount(db, workspaceId)) <= 1
  ) {
    throw conflict('A workspace must keep at least one active owner');
  }

  if (current.status === status) return current;

  await db
    .update(memberships)
    .set({
      status,
      deactivatedAt: status === 'inactive' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, targetUserId)));

  return { ...current, status };
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

// ---------------------------------------------------------------------------
// Workspace deletion (owner-only, two-step: type the name, then click an email link)
// ---------------------------------------------------------------------------

const WORKSPACE_DELETION_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Level 1 of workspace deletion: the owner re-types the workspace name to confirm
 * intent. On a match we mint a single-use token (stored only as a hash) and
 * return it plus the owner's email so the caller can send the confirmation link.
 * Any earlier unconsumed token for this workspace is dropped so only the newest
 * link works.
 */
export async function requestWorkspaceDeletion(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  confirmName: string,
): Promise<{ token: string; email: string; workspaceName: string }> {
  await requireRole(db, workspaceId, actorUserId, OWNER_ROLES);

  const [ws] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!ws) throw notFound('Workspace not found');
  if (confirmName.trim() !== ws.name) {
    throw validation('The name you typed does not match the workspace name');
  }

  const [actor] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, actorUserId))
    .limit(1);
  if (!actor) throw notFound('User not found');

  await db
    .delete(workspaceDeletionTokens)
    .where(eq(workspaceDeletionTokens.workspaceId, workspaceId));

  const token = randomBytes(32).toString('base64url');
  await db.insert(workspaceDeletionTokens).values({
    workspaceId,
    requestedByUserId: actorUserId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + WORKSPACE_DELETION_TTL_MS),
  });

  return { token, email: actor.email, workspaceName: ws.name };
}

/**
 * Level 2 of workspace deletion: consume the emailed token and permanently
 * delete the workspace. The token identifies the workspace; the actor must still
 * be an owner of it. Deletes the backing organization, which cascades the
 * workspace and everything under it. usage_rollups_daily has no FK (denormalized),
 * so it is cleared explicitly for the org's workspaces.
 */
export async function confirmWorkspaceDeletion(
  db: Database,
  actorUserId: string,
  token: string,
): Promise<{ workspaceId: string }> {
  const [row] = await db
    .select()
    .from(workspaceDeletionTokens)
    .where(
      and(
        eq(workspaceDeletionTokens.tokenHash, hashToken(token)),
        isNull(workspaceDeletionTokens.consumedAt),
        gt(workspaceDeletionTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) throw notFound('This confirmation link is invalid or has expired');

  await requireRole(db, row.workspaceId, actorUserId, OWNER_ROLES);

  const [ws] = await db
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, row.workspaceId))
    .limit(1);
  if (!ws) throw notFound('Workspace not found');

  await db.transaction(async (tx) => {
    // Clear the denormalized rollups for every workspace in the org (no FK to cascade).
    const orgWorkspaces = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.organizationId, ws.organizationId));
    for (const w of orgWorkspaces) {
      await tx.delete(usageRollupsDaily).where(eq(usageRollupsDaily.workspaceId, w.id));
    }
    // Deleting the org cascades its workspaces, memberships, invitations, tasks,
    // agents, handoffs, integrations, and this token.
    await tx.delete(organizations).where(eq(organizations.id, ws.organizationId));
  });

  return { workspaceId: row.workspaceId };
}
