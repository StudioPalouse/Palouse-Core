import { createMiddleware } from 'hono/factory';
import { unauthorized, type AgentKeyScope } from '@reqops/shared';
import { agentService } from '@reqops/core';
import { loadEnv } from '@reqops/config';
import { getDb } from '@reqops/db';

export type AgentKeyVars = {
  Variables: {
    agentKey: agentService.VerifiedAgentKey;
  };
};

/**
 * Authenticates an agent API key from `Authorization: Bearer reqops_agk_...`
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
