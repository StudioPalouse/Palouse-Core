'use client';

import { useMemo } from 'react';
import type { ProjectDetail, ProjectItemWithLinks } from '@palouse/shared';
import { cn } from '@palouse/ui';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_WIDTH = 28; // px per day
const ROW_HEIGHT = 36; // px per item row
const LABEL_WIDTH = 200; // px for the left label column

type Scheduled = {
  item: ProjectItemWithLinks;
  startDay: number; // days from the chart's start
  endDay: number; // inclusive end day index
};

function dayIndex(iso: string, min: number): number {
  return Math.round((new Date(iso).getTime() - min) / DAY_MS);
}

/**
 * A lightweight timeline. Items with a start and/or due date become bars placed
 * over a day axis; dependency edges are drawn as connector lines between bars.
 * Built with plain divs and one SVG overlay: no charting dependency.
 */
export function ProjectGantt({ detail }: { detail: ProjectDetail }) {
  const { scheduled, unscheduled, totalDays, min } = useMemo(() => {
    const dated = detail.items.filter((i) => i.startDate || i.endDate);
    if (dated.length === 0) {
      return { scheduled: [] as Scheduled[], unscheduled: detail.items, totalDays: 0, min: 0 };
    }
    const stamps: number[] = [];
    for (const i of dated) {
      if (i.startDate) stamps.push(new Date(i.startDate).getTime());
      if (i.endDate) stamps.push(new Date(i.endDate).getTime());
    }
    const min = Math.min(...stamps);
    const max = Math.max(...stamps);
    const scheduled: Scheduled[] = dated
      .map((item) => {
        const startIso = item.startDate ?? item.endDate!;
        const endIso = item.endDate ?? item.startDate!;
        return { item, startDay: dayIndex(startIso, min), endDay: dayIndex(endIso, min) };
      })
      .sort((a, b) => a.startDay - b.startDay || a.endDay - b.endDay);
    const totalDays = Math.round((max - min) / DAY_MS) + 1;
    return { scheduled, unscheduled: detail.items.filter((i) => !i.startDate && !i.endDate), totalDays, min };
  }, [detail.items]);

  if (scheduled.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border p-8 text-center text-sm">
        No cards have dates yet. Add a start or due date to a card to place it on the timeline.
      </p>
    );
  }

  const rowById = new Map(scheduled.map((s, i) => [s.item.id, i]));
  const chartWidth = totalDays * DAY_WIDTH;
  const chartHeight = scheduled.length * ROW_HEIGHT;

  // Weekly ticks along the top axis.
  const ticks: { day: number; label: string }[] = [];
  for (let d = 0; d < totalDays; d += 7) {
    const date = new Date(min + d * DAY_MS);
    ticks.push({ day: d, label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="flex" style={{ minWidth: LABEL_WIDTH + chartWidth }}>
        {/* Left label column */}
        <div className="bg-background sticky left-0 z-10 shrink-0 border-r" style={{ width: LABEL_WIDTH }}>
          <div className="h-8 border-b" />
          {scheduled.map((s) => (
            <div
              key={s.item.id}
              className="flex items-center truncate border-b px-3 text-sm"
              style={{ height: ROW_HEIGHT }}
              title={s.item.title}
            >
              <span className={cn('truncate', s.item.completedAt && 'text-muted-foreground line-through')}>
                {s.item.title}
              </span>
            </div>
          ))}
        </div>

        {/* Chart area */}
        <div className="relative" style={{ width: chartWidth }}>
          {/* Axis */}
          <div className="relative h-8 border-b" style={{ width: chartWidth }}>
            {ticks.map((t) => (
              <div
                key={t.day}
                className="text-muted-foreground absolute top-0 flex h-8 items-center border-l pl-1 text-xs"
                style={{ left: t.day * DAY_WIDTH }}
              >
                {t.label}
              </div>
            ))}
          </div>

          {/* Rows + bars */}
          <div className="relative" style={{ height: chartHeight }}>
            {scheduled.map((s) => {
              const width = (s.endDay - s.startDay + 1) * DAY_WIDTH;
              const rowIndex = rowById.get(s.item.id)!;
              return (
                <div
                  key={s.item.id}
                  className="absolute right-0 left-0 border-b"
                  style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
                >
                  <div
                    className={cn(
                      'absolute top-1/2 flex h-5 -translate-y-1/2 items-center rounded px-2 text-xs text-white',
                      s.item.completedAt ? 'bg-status-done' : 'bg-primary',
                    )}
                    style={{ left: s.startDay * DAY_WIDTH, width: Math.max(width, DAY_WIDTH) }}
                  />
                </div>
              );
            })}

            {/* Dependency connectors */}
            <svg
              className="pointer-events-none absolute top-0 left-0"
              width={chartWidth}
              height={chartHeight}
            >
              {scheduled.flatMap((s, successorRow) =>
                s.item.predecessorItemIds.flatMap((pid) => {
                  const predRow = rowById.get(pid);
                  if (predRow === undefined) return [];
                  const pred = scheduled[predRow];
                  if (!pred) return [];
                  const x1 = (pred.endDay + 1) * DAY_WIDTH;
                  const y1 = predRow * ROW_HEIGHT + ROW_HEIGHT / 2;
                  const x2 = s.startDay * DAY_WIDTH;
                  const y2 = successorRow * ROW_HEIGHT + ROW_HEIGHT / 2;
                  const midX = Math.max(x1 + 8, (x1 + x2) / 2);
                  return [
                    <polyline
                      key={`${pid}-${s.item.id}`}
                      points={`${x1},${y1} ${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                      className="fill-none stroke-muted-foreground/60"
                      strokeWidth={1.5}
                      markerEnd="url(#gantt-arrow)"
                    />,
                  ];
                }),
              )}
              <defs>
                <marker
                  id="gantt-arrow"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L6,3 L0,6 Z" className="fill-muted-foreground/60" />
                </marker>
              </defs>
            </svg>
          </div>
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className="text-muted-foreground border-t p-3 text-xs">
          {unscheduled.length} card{unscheduled.length === 1 ? '' : 's'} without dates not shown.
        </div>
      )}
    </div>
  );
}
