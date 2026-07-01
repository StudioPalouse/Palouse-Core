import { Hono } from 'hono';
import { confirmAccountDeletionInput, validation } from '@palouse/shared';
import { workspaces } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb } from '@palouse/db';
import { requireSession, type SessionVars } from '../middleware/session.js';

export const accountRoutes = new Hono<SessionVars>();

accountRoutes.use('*', requireSession);

// Level 2 of account deletion: consume the emailed token. The token carries the
// workspace, so this is not nested under /workspaces/:id. The signed-in user must
// still be an owner of that workspace (checked in the service).
accountRoutes.post('/deletion/confirm', async (c) => {
  const parsed = confirmAccountDeletionInput.safeParse(await c.req.json());
  if (!parsed.success) throw validation('Invalid token', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  const result = await workspaces.confirmAccountDeletion(db, c.get('userId'), parsed.data.token);
  return c.json(result);
});
