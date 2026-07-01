'use client';

import { SlidersHorizontal } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@palouse/ui';
import {
  GROUP_BY_LABELS,
  SORT_BY_LABELS,
  type DisplayConfig,
  type GroupBy,
  type SortBy,
} from '@/lib/task-views';

export function TaskDisplayMenu({
  config,
  onChange,
}: {
  config: DisplayConfig;
  onChange: (config: DisplayConfig) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal className="size-4" />
          Display
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-muted-foreground text-xs">Group by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={config.groupBy}
          onValueChange={(v) => onChange({ ...config, groupBy: v as GroupBy })}
        >
          {(Object.keys(GROUP_BY_LABELS) as GroupBy[]).map((g) => (
            <DropdownMenuRadioItem key={g} value={g}>
              {GROUP_BY_LABELS[g]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs">Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={config.sortBy}
          onValueChange={(v) => onChange({ ...config, sortBy: v as SortBy })}
        >
          {(Object.keys(SORT_BY_LABELS) as SortBy[]).map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {SORT_BY_LABELS[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
