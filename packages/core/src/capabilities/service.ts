import { eq } from 'drizzle-orm';
import { workspaceCapabilities, type Database } from '@palouse/db';
import {
  CAPABILITY_KEYS,
  type CapabilityKey,
  type MemberRole,
  type WorkspaceCapabilities,
} from '@palouse/shared';
import { requireMembership, requireRole } from '../workspaces/service.js';

const ADMIN_ROLES: MemberRole[] = ['owner', 'admin'];

/**
 * The workspace's capability map with no auth check, for callers that carry
 * their own tenancy (e.g. agent keys). Rows are overrides; a capability with
 * no row is enabled.
 */
export async function capabilitiesForWorkspace(
  db: Database,
  workspaceId: string,
): Promise<WorkspaceCapabilities> {
  const rows = await db
    .select({
      capability: workspaceCapabilities.capability,
      enabled: workspaceCapabilities.enabled,
    })
    .from(workspaceCapabilities)
    .where(eq(workspaceCapabilities.workspaceId, workspaceId));

  const map = Object.fromEntries(
    CAPABILITY_KEYS.map((key) => [key, true]),
  ) as WorkspaceCapabilities;
  for (const row of rows) map[row.capability] = row.enabled;
  return map;
}

/** Capability map for a member of the workspace. Any role may read. */
export async function getCapabilities(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceCapabilities> {
  await requireMembership(db, workspaceId, userId);
  return capabilitiesForWorkspace(db, workspaceId);
}

/**
 * Enable or disable a capability. Requires owner/admin. Upserts the override
 * row and returns the full refreshed map.
 */
export async function setCapability(
  db: Database,
  workspaceId: string,
  actorUserId: string,
  capability: CapabilityKey,
  enabled: boolean,
): Promise<WorkspaceCapabilities> {
  await requireRole(db, workspaceId, actorUserId, ADMIN_ROLES);
  await db
    .insert(workspaceCapabilities)
    .values({ workspaceId, capability, enabled, updatedByUserId: actorUserId })
    .onConflictDoUpdate({
      target: [workspaceCapabilities.workspaceId, workspaceCapabilities.capability],
      set: { enabled, updatedByUserId: actorUserId, updatedAt: new Date() },
    });
  return capabilitiesForWorkspace(db, workspaceId);
}
