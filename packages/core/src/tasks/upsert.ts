import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { taskSources, tasks, type Database } from '@palouse/db';
import type { NormalizedExternalTask } from '@palouse/connector-core';
import { appendAuditEvent } from '../audit/chain.js';

export function idempotencyKeyFor(
  system: string,
  integrationId: string,
  externalId: string,
): string {
  return createHash('sha256').update(`${system}|${integrationId}|${externalId}`).digest('hex');
}

export interface UpsertResult {
  taskId: string;
  created: boolean;
}

/**
 * Idempotent external-task upsert keyed on task_sources(external_system,
 * external_id, integration_id). Conflict policy per docs/architecture.md §4:
 * the external system wins for the fields it owns (title, status, due,
 * description); Palouse-only fields are left untouched.
 */
export async function upsertExternalTask(
  db: Database,
  workspaceId: string,
  integrationId: string,
  ext: NormalizedExternalTask,
): Promise<UpsertResult> {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(taskSources)
      .where(
        and(
          eq(taskSources.externalSystem, ext.externalSystem),
          eq(taskSources.externalId, ext.externalId),
          eq(taskSources.integrationId, integrationId),
        ),
      )
      .limit(1);

    const externalFields = {
      title: ext.title,
      descriptionMd: ext.descriptionMd ?? null,
      status: ext.status,
      dueAt: ext.dueAt ? new Date(ext.dueAt) : null,
      lastSyncedAt: new Date(),
      etag: ext.externalEtag ?? null,
      updatedAt: new Date(),
    };

    if (source) {
      // Skip no-op updates when the provider reports an unchanged etag/timestamp.
      const unchanged =
        ext.externalEtag != null
          ? source.externalEtag === ext.externalEtag
          : ext.externalUpdatedAt != null &&
            source.externalUpdatedAt?.toISOString() === ext.externalUpdatedAt;
      if (!unchanged) {
        await tx.update(tasks).set(externalFields).where(eq(tasks.id, source.taskId));
        await tx
          .update(taskSources)
          .set({
            externalUrl: ext.externalUrl ?? source.externalUrl,
            externalEtag: ext.externalEtag ?? null,
            externalUpdatedAt: ext.externalUpdatedAt ? new Date(ext.externalUpdatedAt) : null,
            updatedAt: new Date(),
          })
          .where(eq(taskSources.id, source.id));
      }
      return { taskId: source.taskId, created: false };
    }

    const [task] = await tx
      .insert(tasks)
      .values({
        workspaceId,
        ...externalFields,
        sourceOfTruth: 'external',
        externalCanonicalId: ext.externalId,
      })
      .returning({ id: tasks.id });

    await tx.insert(taskSources).values({
      taskId: task!.id,
      integrationId,
      externalSystem: ext.externalSystem,
      externalId: ext.externalId,
      externalUrl: ext.externalUrl ?? null,
      externalEtag: ext.externalEtag ?? null,
      externalUpdatedAt: ext.externalUpdatedAt ? new Date(ext.externalUpdatedAt) : null,
      idempotencyKey: idempotencyKeyFor(ext.externalSystem, integrationId, ext.externalId),
    });

    await appendAuditEvent(tx, {
      workspaceId,
      actorType: 'system',
      actorId: null,
      action: 'task.synced_in',
      targetType: 'task',
      targetId: task!.id,
      payload: { externalSystem: ext.externalSystem, externalId: ext.externalId, integrationId },
    });

    return { taskId: task!.id, created: true };
  });
}
