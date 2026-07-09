'use client';

import Link from 'next/link';
import type { MemberRole } from '@palouse/shared';
import { Button } from '@palouse/ui';
import { EmptyState } from '@/components/fieldwork/empty-state';
import { CONNECTOR_CATALOG } from '@/lib/connectors';
import { canManage } from '@/lib/roles';

/**
 * First-run empty state for the task list, drawn as a Fieldwork moment (horizon
 * backdrop, quiet Plex headline) with a functional nudge. A workspace has no
 * tasks until it syncs a service (or someone adds one by hand), so this points
 * managers into the connection flow and tells everyone else who can set one up,
 * since only owners and admins can manage integrations.
 */
export function TasksEmptyState({ role }: { role: MemberRole | null | undefined }) {
  const manage = canManage(role);
  return (
    <EmptyState
      bordered={false}
      title="No tasks yet"
      description="Connect a task service to bring your team's existing work into Palouse, kept in sync automatically."
      action={
        <div className="flex flex-col items-center gap-3">
          <ul className="flex flex-wrap justify-center gap-2">
            {CONNECTOR_CATALOG.map((connector) => (
              <li
                key={connector.provider}
                className="bg-muted/60 rounded-full px-3 py-1 text-xs font-medium"
              >
                {connector.label}
              </li>
            ))}
          </ul>
          {manage ? (
            <div className="flex flex-col items-center gap-1.5">
              <Button size="sm" asChild>
                <Link href="/settings/integrations">Connect a service</Link>
              </Button>
              <p className="text-muted-foreground text-xs">
                Prefer to start fresh? Add one with New task above.
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground max-w-md text-xs">
              Ask a workspace owner or admin to connect one, or add a task by hand with New task
              above.
            </p>
          )}
        </div>
      }
    />
  );
}
