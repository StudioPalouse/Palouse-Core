'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatUsd } from '@/lib/handoff-meta';
import {
  axisProps,
  cursorFill,
  endpointDot,
  gridProps,
  seriesColor,
  tooltipLabelStyle,
  tooltipStyle,
} from '@/components/charts/chart-theme';

// Spend is a single series, so it takes the first categorical slot (fern).
const FILL = seriesColor(0);
const usd = (v: number | string) => formatUsd(Number(v));
// recharts 3 tightened the Tooltip Formatter signature (its value can be an
// array); accept unknown and coerce, which is assignable to that type.
const usdTooltip = (v: unknown) => formatUsd(Number(v));

export function DailySpendChart({ data }: { data: { date: string; cost: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={52} tickFormatter={usd} />
        <Tooltip
          formatter={usdTooltip}
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          cursor={{ stroke: 'var(--color-border)' }}
        />
        <Area
          type="monotone"
          dataKey="cost"
          stroke={FILL}
          strokeWidth={2}
          fill={FILL}
          fillOpacity={0.12}
          activeDot={endpointDot(FILL)}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BreakdownChart({ data }: { data: { name: string; cost: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <XAxis type="number" {...axisProps} tickFormatter={usd} />
        <YAxis type="category" dataKey="name" {...axisProps} width={120} />
        <Tooltip
          formatter={usdTooltip}
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          cursor={cursorFill}
        />
        <Bar dataKey="cost" fill={FILL} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MiniSpark({ data }: { data: { date: string; cost: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={56}>
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <Tooltip
          formatter={usdTooltip}
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
        />
        <Area
          type="monotone"
          dataKey="cost"
          stroke={FILL}
          strokeWidth={2}
          fill={FILL}
          fillOpacity={0.12}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
