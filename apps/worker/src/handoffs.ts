import type { Logger } from 'pino';
import type { Database } from '@palouse/db';
import { handoffService } from '@palouse/core';
import type { HandoffNotifyJob } from '@palouse/queue';

export async function runReapExpired(db: Database, logger: Logger): Promise<void> {
  const { requeued, failed, cancelled } = await handoffService.reapExpired(db);
  if (requeued || failed || cancelled) {
    logger.info({ requeued, failed, cancelled }, 'Handoff reaper swept');
  }
}

/**
 * Agent notification dispatch. v1 has no push channels — MCP agents poll via
 * claim_task — so this only logs; the paperclip/webhook adapters hook in here.
 */
export async function runNotifyAgent(logger: Logger, job: HandoffNotifyJob): Promise<void> {
  logger.info({ handoffId: job.handoffId, agentId: job.agentId }, 'Handoff queued for agent');
}
