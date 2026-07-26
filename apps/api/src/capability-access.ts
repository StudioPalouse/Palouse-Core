import { forbidden } from '@palouse/shared';
import { capabilityService, workspaces } from '@palouse/core';
import type { Database } from '@palouse/db';

/**
 * Membership + the tasks capability must both be satisfied. Mirrors the
 * `requireProjectsAccess` / `requireObjectivesAccess` guards in those route
 * files; it lives here because two routers share it (tasks and handoffs, the
 * latter also serving the review surface the web app files under /reviews).
 * Returns the workspace capability set so callers can gate cross-capability
 * data.
 */
export async function requireTasksAccess(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<Awaited<ReturnType<typeof capabilityService.capabilitiesForWorkspace>>> {
  await workspaces.requireMembership(db, workspaceId, userId);
  const caps = await capabilityService.capabilitiesForWorkspace(db, workspaceId);
  if (caps.tasks === false)
    throw forbidden('The Tasks capability is turned off for this workspace.');
  return caps;
}
