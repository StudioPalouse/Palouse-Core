import { Hono } from 'hono';
import { acceptInviteInput, validation } from '@palouse/shared';
import { workspaces } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb } from '@palouse/db';
import { requireSession, type SessionVars } from '../middleware/session.js';

export const invitationRoutes = new Hono<SessionVars>();

invitationRoutes.use('*', requireSession);

// Accept an invitation for the signed-in user. The token carries the workspace,
// so this is not nested under /workspaces/:id.
invitationRoutes.post('/accept', async (c) => {
  const parsed = acceptInviteInput.safeParse(await c.req.json());
  if (!parsed.success) throw validation('Invalid token', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  const result = await workspaces.acceptInvite(db, c.get('userId'), parsed.data.token);
  return c.json(result);
});
