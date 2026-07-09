'use client';

import { Bot } from 'lucide-react';
import type { ObjectiveListItem } from '@palouse/shared';
import { cn, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@palouse/ui';
import {
  EMPTY,
  formatDate,
  OBJECTIVE_STATUS_LABELS,
  OBJECTIVE_STATUS_TONE,
} from '@/lib/objective-meta';

/**
 * A slim growth progress bar with the percentage beside it. The fill runs
 * forest-to-gold, planting to harvest (docs/design-system.md section 3.5); at
 * 100% a one-time sweep crosses the bar. That sweep is the whole playful budget
 * for this component, and it is disabled under prefers-reduced-motion.
 */
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, Math.round(value)));
  const complete = pct === 100;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="bg-muted relative h-1.5 flex-1 overflow-hidden rounded-full">
        <div
          className="from-primary to-harvest h-full rounded-full bg-linear-to-r transition-all"
          style={{ width: `${pct}%` }}
        />
        {complete && (
          <span
            key="sweep"
            className="animate-harvest-sweep absolute inset-0 bg-linear-to-r from-transparent via-white/50 to-transparent"
          />
        )}
      </div>
      <span className="text-muted-foreground w-9 shrink-0 text-right text-xs tabular-nums">
        {pct}%
      </span>
    </div>
  );
}

export function ObjectiveList({
  objectives,
  onSelect,
}: {
  objectives: ObjectiveListItem[];
  onSelect: (id: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Objective</TableHead>
          <TableHead className="w-28">Status</TableHead>
          <TableHead className="w-40">Area</TableHead>
          <TableHead className="w-48">Progress</TableHead>
          <TableHead className="w-24 text-center">Key results</TableHead>
          <TableHead className="w-28">Target</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {objectives.map((o) => (
          <TableRow key={o.id} className="cursor-pointer" onClick={() => onSelect(o.id)}>
            <TableCell className="font-medium">
              <span className="flex items-center gap-2">
                <span className="truncate">{o.title}</span>
                {o.origin === 'agent' && (
                  <Bot
                    className="text-muted-foreground size-3.5 shrink-0"
                    aria-label="Agent created"
                  />
                )}
              </span>
            </TableCell>
            <TableCell>
              <span
                className={cn(
                  'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                  OBJECTIVE_STATUS_TONE[o.status],
                )}
              >
                {OBJECTIVE_STATUS_LABELS[o.status]}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground">{o.area || EMPTY}</TableCell>
            <TableCell>
              {o.keyResultCount === 0 ? (
                <span className="text-muted-foreground text-xs">No key results</span>
              ) : (
                <ProgressBar value={o.progress} />
              )}
            </TableCell>
            <TableCell className="text-muted-foreground text-center">
              {o.keyResultCount || EMPTY}
            </TableCell>
            <TableCell className="text-muted-foreground">{formatDate(o.targetDate)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
