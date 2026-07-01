import type { MemberRole } from '@palouse/shared';

/** Owners and admins can manage a workspace (members, integrations, agents, settings). */
export function canManage(role: MemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** Only owners can manage organization-level concerns (billing, deletion). */
export function isOwner(role: MemberRole | null | undefined): boolean {
  return role === 'owner';
}
