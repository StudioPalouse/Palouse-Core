import { createMiddleware } from 'hono/factory';
import { unauthorized, type AgentKeyScope } from '@palouse/shared';
import { agentService } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { getDb } from '@palouse/db';

export type AgentKeyVars = {
  Variables: {
    agentKey: agentService.VerifiedAgentKey;
  };
};

/**
 * Authenticates an agent API key from `Authorization: Bearer palouse_agk_...`
 * and enforces a scope, mirroring the MCP server's per-request auth. Used by
 * machine-facing endpoints (OTLP ingest) where there is no browser session.
 */
export function requireAgentKey(scope: AgentKeyScope) {
  return createMiddleware<AgentKeyVars>(async (c, next) => {
    const match = c.req.header('authorization')?.match(/^Bearer\s+(\S+)$/i);
    if (!match) throw unauthorized('Missing Authorization: Bearer <agent api key>');
    const db = getDb(loadEnv().DATABASE_URL);
    const key = await agentService.verifyApiKey(db, match[1]!);
    agentService.requireScope(key, scope);
    c.set('agentKey', key);
    await next();
  });
}
