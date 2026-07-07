'use client';

import { Bot } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import type { ProjectListItem } from '@palouse/shared';
import { cn, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@palouse/ui';
import { ProgressBar } from './objective-list';
import { EMPTY, PROJECT_STATUS_LABELS, PROJECT_STATUS_TONE } from '@/lib/project-meta';

export function ProjectList({ projects }: { projects: ProjectListItem[] }) {
  const router = useRouter();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Project</TableHead>
          <TableHead className="w-28">Status</TableHead>
          <TableHead className="w-48">Progress</TableHead>
          <TableHead className="w-24 text-center">Cards</TableHead>
          <TableHead className="w-24 text-center">Done</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map((p) => (
          <TableRow
            key={p.id}
            className="cursor-pointer"
            onClick={() => router.push(`/projects/${p.id}` as Route)}
          >
            <TableCell className="font-medium">
              <span className="flex items-center gap-2">
                <span className="truncate">{p.name}</span>
                {p.origin === 'agent' && (
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
                  PROJECT_STATUS_TONE[p.status],
                )}
              >
                {PROJECT_STATUS_LABELS[p.status]}
              </span>
            </TableCell>
            <TableCell>
              {p.itemCount === 0 ? (
                <span className="text-muted-foreground text-xs">No cards</span>
              ) : (
                <ProgressBar value={p.progress} />
              )}
            </TableCell>
            <TableCell className="text-muted-foreground text-center">
              {p.itemCount || EMPTY}
            </TableCell>
            <TableCell className="text-muted-foreground text-center">
              {p.itemCount === 0 ? EMPTY : p.completedCount}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
