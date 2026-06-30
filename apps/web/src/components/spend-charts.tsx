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

const AXIS = 'var(--color-muted-foreground)';
const FILL = 'var(--color-primary)';
const usd = (v: number | string) => formatUsd(Number(v));

export function DailySpendChart({ data }: { data: { date: string; cost: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: AXIS }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: AXIS }}
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={usd}
        />
        <Tooltip formatter={usd} contentStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="cost" stroke={FILL} fill={FILL} fillOpacity={0.15} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BreakdownChart({ data }: { data: { name: string; cost: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: AXIS }}
          tickLine={false}
          axisLine={false}
          tickFormatter={usd}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 11, fill: AXIS }}
          tickLine={false}
          axisLine={false}
          width={120}
        />
        <Tooltip formatter={usd} contentStyle={{ fontSize: 12 }} cursor={{ fill: 'var(--color-accent)' }} />
        <Bar dataKey="cost" fill={FILL} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MiniSpark({ data }: { data: { date: string; cost: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={56}>
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <Tooltip formatter={usd} contentStyle={{ fontSize: 12 }} labelStyle={{ fontSize: 11 }} />
        <Area type="monotone" dataKey="cost" stroke={FILL} fill={FILL} fillOpacity={0.15} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
