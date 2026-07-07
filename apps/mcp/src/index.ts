import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import pino from 'pino';
import { loadEnv } from '@palouse/config';
import { getDb, type Database } from '@palouse/db';
import { ALL_AGENT_KEY_SCOPES, PalouseError } from '@palouse/shared';
import { oauthAudience, oauthIssuer, verifyKeyFromEnv, verifyKeyFromHeader } from './auth.js';
import { buildServer } from './server.js';

const useStdio = process.argv.includes('--stdio') || process.env.PALOUSE_MCP_TRANSPORT === 'stdio';

const env = loadEnv();
// stdio owns stdout for the protocol — logs must go to stderr there.
const logger = pino(
  { level: env.LOG_LEVEL, base: { service: 'palouse-mcp' } },
  useStdio ? pino.destination(2) : undefined,
);

const db = getDb(env.DATABASE_URL);

async function runStdio(database: Database): Promise<void> {
  const key = await verifyKeyFromEnv(database);
  const server = await buildServer(database, key);
  await server.connect(new StdioServerTransport());
  logger.info({ agentId: key.agentId, workspaceId: key.workspaceId }, 'MCP stdio transport ready');
}

/**
 * Stateless streamable HTTP: each request authenticates its own Bearer agent
 * key and gets a fresh server/transport pair, so one process serves any
 * number of agents without session bookkeeping.
 */
function runHttp(database: Database): void {
  // RFC 9728 protected-resource metadata: MCP clients follow this from the
  // 401 WWW-Authenticate header to discover the authorization server, then
  // run the OAuth connect flow (docs/PLAN-mcp-oauth.md).
  const resourceMetadata = JSON.stringify({
    resource: oauthAudience(),
    authorization_servers: [oauthIssuer()],
    bearer_methods_supported: ['header'],
    scopes_supported: [...ALL_AGENT_KEY_SCOPES, 'offline_access'],
  });
  const resourceMetadataUrl = `${new URL(oauthAudience()).origin}/.well-known/oauth-protected-resource/mcp`;

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = req.url?.split('?')[0];
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    // Both the root form and the path-insert form (resource path is /mcp);
    // clients construct either.
    if (
      path === '/.well-known/oauth-protected-resource' ||
      path === '/.well-known/oauth-protected-resource/mcp'
    ) {
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      });
      res.end(resourceMetadata);
      return;
    }
    // The protocol lives at /mcp only, so the URL in configs stays unambiguous
    // and the root remains free for a human-facing page later.
    if (path !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. The MCP endpoint is /mcp.' }));
      return;
    }
    try {
      const key = await verifyKeyFromHeader(database, req.headers.authorization);
      const server = await buildServer(database, key);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      const status = err instanceof PalouseError ? err.status : 500;
      const message = err instanceof PalouseError ? err.message : 'Internal server error';
      if (status >= 500) logger.error({ err }, 'MCP request failed');
      if (!res.headersSent) {
        // On 401, point OAuth-capable clients at the resource metadata so
        // they can start the connect flow instead of failing outright.
        if (status === 401) {
          res.setHeader(
            'WWW-Authenticate',
            `Bearer resource_metadata="${resourceMetadataUrl}"`,
          );
        }
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message },
            id: null,
          }),
        );
      }
    }
  });

  httpServer.listen(env.MCP_HTTP_PORT, () => {
    logger.info({ port: env.MCP_HTTP_PORT }, 'MCP streamable HTTP transport listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (useStdio) {
  runStdio(db).catch((err) => {
    logger.error({ err }, 'Failed to start stdio transport');
    process.exit(1);
  });
} else {
  runHttp(db);
}
