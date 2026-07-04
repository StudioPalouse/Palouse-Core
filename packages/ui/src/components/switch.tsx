'use client';

import * as React from 'react';
import { cn } from '../lib/utils';

/**
 * A small on/off switch. Plain button with the switch ARIA role rather than a
 * Radix primitive: the behavior is a single toggle, so no extra dependency.
 */
function Switch({
  className,
  checked,
  onCheckedChange,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onClick'> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      data-state={checked ? 'checked' : 'unchecked'}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        'focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'bg-background pointer-events-none block size-4 rounded-full shadow-sm transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export { Switch };
