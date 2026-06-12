import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import pino from 'pino';
import { loadEnv } from '@reqops/config';
import { getDb, type Database } from '@reqops/db';
import { ReqOpsError } from '@reqops/shared';
import { verifyKeyFromEnv, verifyKeyFromHeader } from './auth.js';
import { buildServer } from './server.js';

const useStdio =
  process.argv.includes('--stdio') || process.env.REQOPS_MCP_TRANSPORT === 'stdio';

const env = loadEnv();
// stdio owns stdout for the protocol — logs must go to stderr there.
const logger = pino(
  { level: env.LOG_LEVEL, base: { service: 'reqops-mcp' } },
  useStdio ? pino.destination(2) : undefined,
);

const db = getDb(env.DATABASE_URL);

async function runStdio(database: Database): Promise<void> {
  const key = await verifyKeyFromEnv(database);
  const server = buildServer(database, key);
  await server.connect(new StdioServerTransport());
  logger.info({ agentId: key.agentId, workspaceId: key.workspaceId }, 'MCP stdio transport ready');
}

/**
 * Stateless streamable HTTP: each request authenticates its own Bearer agent
 * key and gets a fresh server/transport pair, so one process serves any
 * number of agents without session bookkeeping.
 */
function runHttp(database: Database): void {
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    try {
      const key = await verifyKeyFromHeader(database, req.headers.authorization);
      const server = buildServer(database, key);
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
      const status = err instanceof ReqOpsError ? err.status : 500;
      const message = err instanceof ReqOpsError ? err.message : 'Internal server error';
      if (status >= 500) logger.error({ err }, 'MCP request failed');
      if (!res.headersSent) {
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
