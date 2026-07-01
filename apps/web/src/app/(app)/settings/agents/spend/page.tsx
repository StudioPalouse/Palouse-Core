'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UsageSummaryRow } from '@palouse/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@palouse/ui';
import { Download } from 'lucide-react';
import { AgentsTabs } from '@/components/agents-tabs';
import { BreakdownChart, DailySpendChart } from '@/components/spend-charts';
import { api } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { formatTokens, formatUsd } from '@/lib/handoff-meta';

type SpendData = {
  total: number;
  daily: { date: string; cost: number }[];
  byAgent: UsageSummaryRow[];
  byModel: { name: string; cost: number }[];
};

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
] as const;

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadAgentCsv(rows: UsageSummaryRow[]) {
  const header = [
    'agentId',
    'agent',
    'generations',
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'costUsd',
    'unpricedCount',
  ];
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [
        r.key,
        r.label ?? '',
        r.generationCount,
        r.inputTokens,
        r.outputTokens,
        r.cacheReadTokens,
        r.cacheWriteTokens,
        r.costUsd.toFixed(6),
        r.unpricedCount,
      ]
        .map(csvCell)
        .join(','),
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'palouse-agent-spend.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function AgentsSpendPage() {
  return <AgentsSpendContent />;
}

function AgentsSpendContent() {
  const { workspace } = useActiveWorkspace();
  const [days, setDays] = useState('30');
  const [data, setData] = useState<SpendData | null>(null);

  const refresh = useCallback(() => {
    if (!workspace) return;
    const id = workspace.id;
    const from = new Date();
    from.setDate(from.getDate() - Number(days));
    const fromIso = from.toISOString();
    setData(null);

    Promise.all([
      api.getUsageSummary(id, { from: fromIso, groupBy: 'day' }),
      api.getUsageSummary(id, { from: fromIso, groupBy: 'agent' }),
      api.getUsageSummary(id, { from: fromIso, groupBy: 'model' }),
    ]).then(([day, agent, model]) => {
      setData({
        total: day.totalCostUsd,
        daily: day.rows.map((r) => ({ date: r.key.slice(5), cost: r.costUsd })),
        byAgent: [...agent.rows].sort((a, b) => b.costUsd - a.costUsd),
        byModel: [...model.rows]
          .sort((a, b) => b.costUsd - a.costUsd)
          .map((r) => ({ name: r.key, cost: r.costUsd })),
      });
    });
  }, [workspace, days]);

  useEffect(refresh, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">
          Agents
          {workspace && (
            <span className="text-muted-foreground ml-2 text-sm font-normal">{workspace.name}</span>
          )}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!data || data.byAgent.length === 0}
            onClick={() => data && downloadAgentCsv(data.byAgent)}
          >
            <Download className="size-4" /> CSV
          </Button>
        </div>
      </div>

      <AgentsTabs />

      {data === null ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <>
          <Card>
            <CardHeader className="flex-row items-baseline justify-between">
              <CardTitle className="text-sm">Daily spend</CardTitle>
              <span className="text-muted-foreground text-sm">{formatUsd(data.total)} total</span>
            </CardHeader>
            <CardContent>
              {data.daily.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  No usage recorded in this period.
                </p>
              ) : (
                <DailySpendChart data={data.daily} />
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">By agent</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {data.byAgent.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center text-sm">No agent spend.</p>
                ) : (
                  <>
                    <BreakdownChart
                      data={data.byAgent.map((r) => ({ name: r.label ?? r.key, cost: r.costUsd }))}
                    />
                    <ul className="divide-y text-sm">
                      {data.byAgent.map((r) => (
                        <li key={r.key} className="flex items-center gap-3 py-1.5">
                          <span className="min-w-0 flex-1 truncate">{r.label ?? r.key}</span>
                          <span className="text-muted-foreground text-xs">
                            {formatTokens(r.inputTokens + r.outputTokens)} tok
                          </span>
                          <span className="w-20 text-right">{formatUsd(r.costUsd)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">By model</CardTitle>
              </CardHeader>
              <CardContent>
                {data.byModel.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center text-sm">No model spend.</p>
                ) : (
                  <BreakdownChart data={data.byModel} />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
