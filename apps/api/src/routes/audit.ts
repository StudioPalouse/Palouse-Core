import { Hono } from 'hono';
import { forbidden, listAuditEventsQuery, validation } from '@palouse/shared';
import { auditService, capabilityService, verifyChain, workspaces } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb, type Database } from '@palouse/db';
import { requireSession, type SessionVars } from '../middleware/session.js';

export const auditRoutes = new Hono<SessionVars>();

auditRoutes.use('*', requireSession);

/**
 * Membership + the `audit` capability must both be satisfied. Recording to
 * audit_events is never gated; this read surface is. Returns the capability set.
 */
async function requireAuditAccess(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<Awaited<ReturnType<typeof capabilityService.capabilitiesForWorkspace>>> {
  await workspaces.requireMembership(db, workspaceId, userId);
  const caps = await capabilityService.capabilitiesForWorkspace(db, workspaceId);
  if (caps.audit === false)
    throw forbidden('The Activity capability is turned off for this workspace.');
  return caps;
}

auditRoutes.get('/events', async (c) => {
  const parsed = listAuditEventsQuery.safeParse(c.req.query());
  if (!parsed.success) throw validation('Invalid audit query', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await requireAuditAccess(db, parsed.data.workspaceId, c.get('userId'));
  const result = await auditService.listEvents(db, parsed.data);
  return c.json(result);
});

/**
 * Re-walk the workspace's audit hash chain and report whether it verifies. The
 * Activity feed uses this to show an "Integrity verified" badge; the same walk
 * backs `palouse verify-audit`.
 */
auditRoutes.get('/verify', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) throw validation('workspaceId is required');
  const db = getDb(loadEnv().DATABASE_URL);
  await requireAuditAccess(db, workspaceId, c.get('userId'));
  const result = await verifyChain(db, workspaceId);
  return c.json(result);
});
