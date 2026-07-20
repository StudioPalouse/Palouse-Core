import { z } from 'zod';
import { uuid } from './ids.js';

export const memberRole = z.enum(['owner', 'admin', 'member', 'viewer']);
export type MemberRole = z.infer<typeof memberRole>;

export const membershipStatus = z.enum(['active', 'inactive']);
export type MembershipStatus = z.infer<typeof membershipStatus>;

export const workspaceSchema = z.object({
  id: uuid,
  organizationId: uuid,
  name: z.string(),
  slug: z.string(),
  role: memberRole,
  createdAt: z.string().datetime(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceMemberSchema = z.object({
  userId: uuid,
  email: z.string(),
  name: z.string().nullable(),
  role: memberRole,
  status: membershipStatus,
  joinedAt: z.string().datetime(),
  // Most recent session activity; null when the user has no sessions on record.
  lastActiveAt: z.string().datetime().nullable(),
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

export const updateMemberRoleInput = z.object({
  role: memberRole,
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleInput>;

// Hand ownership to another active member (they become owner, caller becomes admin).
export const transferOwnershipInput = z.object({
  targetUserId: uuid,
});
export type TransferOwnershipInput = z.infer<typeof transferOwnershipInput>;

// Deactivate (status 'inactive') or reactivate (status 'active') a member.
export const setMemberStatusInput = z.object({
  status: membershipStatus,
});
export type SetMemberStatusInput = z.infer<typeof setMemberStatusInput>;

export const invitationStatus = z.enum(['pending', 'accepted', 'revoked', 'expired']);
export type InvitationStatus = z.infer<typeof invitationStatus>;

export const invitationSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  email: z.string().email(),
  role: memberRole,
  status: invitationStatus,
  invitedByUserId: uuid.nullable(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;

// Invites cannot grant ownership; transfer ownership is a separate, deliberate action.
export const inviteRole = z.enum(['admin', 'member', 'viewer']);
export type InviteRole = z.infer<typeof inviteRole>;

export const createInviteInput = z.object({
  email: z.string().email(),
  role: inviteRole.default('member'),
});
export type CreateInviteInput = z.infer<typeof createInviteInput>;

export const acceptInviteInput = z.object({ token: z.string().min(1) });
export type AcceptInviteInput = z.infer<typeof acceptInviteInput>;

export const slug = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'lowercase letters, numbers and hyphens only');

export const createWorkspaceInput = z.object({
  name: z.string().min(1).max(120),
  slug,
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;

// Workspace deletion is two-step: confirmName must match the workspace name
// (level 1), then the emailed token is submitted to actually delete it (level 2).
export const requestWorkspaceDeletionInput = z.object({
  confirmName: z.string().min(1),
});
export type RequestWorkspaceDeletionInput = z.infer<typeof requestWorkspaceDeletionInput>;

export const confirmWorkspaceDeletionInput = z.object({
  token: z.string().min(1),
});
export type ConfirmWorkspaceDeletionInput = z.infer<typeof confirmWorkspaceDeletionInput>;
