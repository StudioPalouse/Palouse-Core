'use client';

import { Bot } from 'lucide-react';
import type { DecisionListItem } from '@palouse/shared';
import { cn, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@palouse/ui';
import {
  DECISION_STATUS_LABELS,
  DECISION_STATUS_TONE,
  EMPTY,
  formatDate,
} from '@/lib/decision-meta';

export function DecisionList({
  decisions,
  onSelect,
}: {
  decisions: DecisionListItem[];
  onSelect: (id: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Decision</TableHead>
          <TableHead className="w-32">Status</TableHead>
          <TableHead className="w-40">Area</TableHead>
          <TableHead className="w-24 text-center">RACI</TableHead>
          <TableHead className="w-24 text-center">Links</TableHead>
          <TableHead className="w-28">Decided</TableHead>
          <TableHead className="w-28">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {decisions.map((d) => (
          <TableRow key={d.id} className="cursor-pointer" onClick={() => onSelect(d.id)}>
            <TableCell className="font-medium">
              <span className="flex items-center gap-2">
                <span className="truncate">{d.title}</span>
                {d.origin === 'agent' && (
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
                  DECISION_STATUS_TONE[d.status],
                )}
              >
                {DECISION_STATUS_LABELS[d.status]}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground">{d.area || EMPTY}</TableCell>
            <TableCell className="text-muted-foreground text-center">
              {d.stakeholderCount || EMPTY}
            </TableCell>
            <TableCell className="text-muted-foreground text-center">
              {d.relationCount || EMPTY}
            </TableCell>
            <TableCell className="text-muted-foreground">{formatDate(d.decidedAt)}</TableCell>
            <TableCell className="text-muted-foreground">{formatDate(d.updatedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
