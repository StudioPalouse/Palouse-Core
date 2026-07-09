import type { ComponentType, ReactNode } from 'react';
import { cn } from '@palouse/ui';
import { Horizon } from '@/components/fieldwork/horizon';

/**
 * An empty state as a quiet moment, not a dashed gray box. A small horizon sits
 * behind a Plex headline and an optional icon and action (docs/design-system.md
 * section 3.5). Use for page- and section-level "nothing here yet" states; leave
 * inline notes ("No comments yet") as plain muted text.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  bordered = true,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Draw the dashed-free bordered card + clip the horizon. Set false when a
   *  parent already provides a bordered, overflow-hidden container. */
  bordered?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-2 px-6 py-14 text-center',
        bordered && 'border-border/70 overflow-hidden rounded-lg border',
        className,
      )}
    >
      <Horizon className="h-16" />
      <div className="relative flex flex-col items-center gap-2">
        {Icon && (
          <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
            <Icon className="size-5" />
          </span>
        )}
        <p className="font-medium">{title}</p>
        {description && <p className="text-muted-foreground max-w-sm text-sm">{description}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
