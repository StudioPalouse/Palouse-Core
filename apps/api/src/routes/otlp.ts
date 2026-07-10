import { Hono } from 'hono';
import { validation } from '@palouse/shared';
import { usageService } from '@palouse/core';
import { loadEnv } from '@palouse/config';
import { auditEvents, getDb } from '@palouse/db';
import { requireAgentKey, type AgentKeyVars } from '../middleware/agent-key.js';
import { rateLimit } from '../middleware/rate-limit.js';

type OtlpPayload = Parameters<typeof usageService.ingestOtlp>[2];

/**
 * OTLP/HTTP ingest. Mounted at /v1/otlp, so the standard exporter path lands at
 * /v1/otlp/v1/traces — an instrumented agent only needs:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=https://<api>/v1/otlp
 *   OTEL_EXPORTER_OTLP_PROTOCOL=http/json
 *   OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer palouse_agk_...
 * v1 accepts OTLP/JSON only; protobuf is rejected with a hint (docs §4).
 */
export const otlpRoutes = new Hono<AgentKeyVars>();

otlpRoutes.use('*', requireAgentKey('usage:write'));
// Keyed by the agent key, not IP: many agents can share one egress IP.
otlpRoutes.use(
  '*',
  rateLimit({
    bucket: 'otlp',
    limit: loadEnv().RATE_LIMIT_OTLP_PER_MIN,
    key: (c) => c.get('agentKey').keyId,
  }),
);

otlpRoutes.post('/v1/traces', async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  if (/protobuf|x-protobuf/i.test(contentType)) {
    return c.json(
      {
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'OTLP protobuf is not supported in v1; set OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
        },
      },
      415,
    );
  }

  let payload: OtlpPayload;
  try {
    payload = (await c.req.json()) as OtlpPayload;
  } catch {
    throw validation('Body must be OTLP/JSON (ExportTraceServiceRequest)');
  }

  const key = c.get('agentKey');
  const db = getDb(loadEnv().DATABASE_URL);
  const result = await usageService.ingestOtlp(
    db,
    { agentId: key.agentId, workspaceId: key.workspaceId },
    payload,
  );

  // Audit the ingest with actor_type='agent', mirroring MCP tool-call logging.
  await db.insert(auditEvents).values({
    workspaceId: key.workspaceId,
    actorType: 'agent',
    actorId: key.agentId,
    action: 'otlp.ingest',
    targetType: 'agent',
    targetId: key.agentId,
    payload: { ...result },
  });

  // OTLP ExportTraceServiceResponse: an empty partialSuccess means full success;
  // uncorrelated spans are surfaced as rejects. `palouse` carries our own counts.
  const rejectedSpans = result.uncorrelatedSpans;
  const partialSuccess =
    rejectedSpans > 0
      ? {
          rejectedSpans,
          errorMessage: `${rejectedSpans} span(s) could not be correlated to an active handoff for this agent`,
        }
      : {};
  return c.json({ partialSuccess, palouse: result }, 200);
});
