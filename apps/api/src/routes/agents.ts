import { Hono } from 'hono';
import {
  createAgentInput,
  createAgentKeyInput,
  listAgentsQuery,
  validation,
} from '@palouse/shared';
import { agentService, workspaces } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb } from '@palouse/db';
import { requireSession, type SessionVars } from '../middleware/session.js';

export const agentRoutes = new Hono<SessionVars>();

agentRoutes.use('*', requireSession);

agentRoutes.get('/', async (c) => {
  const parsed = listAgentsQuery.safeParse(c.req.query());
  if (!parsed.success) throw validation('Invalid agent query', parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, parsed.data.workspaceId, c.get('userId'));
  const agents = await agentService.listAgents(db, parsed.data.workspaceId, {
    includeArchived: parsed.data.includeArchived,
  });
  return c.json({ agents });
});

agentRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const parsed = createAgentInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid agent input', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireRole(db, workspaceId, c.get('userId'), ['owner', 'admin']);
  const agent = await agentService.createAgent(db, workspaceId, c.get('userId'), parsed.data);
  return c.json({ agent }, 201);
});

agentRoutes.get('/:id', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireMembership(db, workspaceId, c.get('userId'));
  const result = await agentService.getAgent(db, workspaceId, c.req.param('id'));
  return c.json(result);
});

// Hard delete; only allowed while the agent has no recorded history (the
// service returns 409 otherwise, pointing the caller at archive).
agentRoutes.delete('/:id', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireRole(db, workspaceId, c.get('userId'), ['owner', 'admin']);
  await agentService.deleteAgent(db, workspaceId, c.get('userId'), c.req.param('id'));
  return c.body(null, 204);
});

agentRoutes.post('/:id/archive', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  if (!workspaceId) throw validation('workspaceId required');
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireRole(db, workspaceId, c.get('userId'), ['owner', 'admin']);
  const agent = await agentService.archiveAgent(db, workspaceId, c.get('userId'), c.req.param('id'));
  return c.json({ agent });
});

agentRoutes.delete('/:id/archive', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireRole(db, workspaceId, c.get('userId'), ['owner', 'admin']);
  const agent = await agentService.unarchiveAgent(
    db,
    workspaceId,
    c.get('userId'),
    c.req.param('id'),
  );
  return c.json({ agent });
});

// The plaintext key appears in this response exactly once and is never
// retrievable again.
agentRoutes.post('/:id/keys', async (c) => {
  const body = await c.req.json();
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const parsed = createAgentKeyInput.safeParse(body);
  if (!parsed.success || !workspaceId)
    throw validation('Invalid key input', parsed.success ? undefined : parsed.error.flatten());
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireRole(db, workspaceId, c.get('userId'), ['owner', 'admin']);
  const { key, plaintext } = await agentService.createApiKey(
    db,
    workspaceId,
    c.get('userId'),
    c.req.param('id'),
    parsed.data,
  );
  return c.json({ key, plaintext }, 201);
});

agentRoutes.delete('/:id/keys/:keyId', async (c) => {
  const workspaceId = c.req.query('workspaceId') ?? '';
  if (!workspaceId) throw validation('workspaceId query param required');
  const db = getDb(loadEnv().DATABASE_URL);
  await workspaces.requireRole(db, workspaceId, c.get('userId'), ['owner', 'admin']);
  await agentService.revokeApiKey(
    db,
    workspaceId,
    c.get('userId'),
    c.req.param('id'),
    c.req.param('keyId'),
  );
  return c.body(null, 204);
});
