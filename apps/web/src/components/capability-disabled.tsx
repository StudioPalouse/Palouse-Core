import Link from 'next/link';
import { ToggleLeft } from 'lucide-react';
import type { CapabilityKey } from '@palouse/shared';
import { Button } from '@palouse/ui';
import { CAPABILITY_LABELS } from '@/lib/capabilities';

/**
 * Shown in place of a page whose capability an admin has turned off, e.g. when
 * someone follows an old link or types the URL directly.
 */
export function CapabilityDisabled({
  capability,
  canManage,
}: {
  capability: CapabilityKey;
  canManage: boolean;
}) {
  const label = CAPABILITY_LABELS[capability];
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-24 text-center">
      <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <ToggleLeft className="size-6" />
      </span>
      <p className="text-sm font-medium">{label} is turned off</p>
      <p className="text-muted-foreground max-w-md text-sm">
        {canManage
          ? `${label} is currently disabled for this workspace. You can turn it back on in workspace settings.`
          : `An administrator has disabled ${label} for this workspace. If you think you need it, ask a workspace admin to turn it back on.`}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
        {canManage && (
          <Button asChild size="sm">
            <Link href="/settings/workspace">Manage capabilities</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
