'use client';

import { useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { HandoffListItem, Task, TaskStatus } from '@palouse/shared';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@palouse/ui';
import {
  Bot,
  ClipboardCheck,
  CircleDollarSign,
  ListChecks,
  Target,
  TrendingUp,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { HANDOFF_STATE_LABELS, formatDateTime, formatUsd } from '@/lib/handoff-meta';
import { STATUS_LABELS, formatDate } from '@/lib/task-meta';

const STATUS_BADGE: Record<TaskStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  open: 'outline',
  in_progress: 'default',
  blocked: 'destructive',
  done: 'secondary',
  archived: 'secondary',
};

type DashboardData = {
  open: number;
  inProgress: number;
  blocked: number;
  needsReview: number;
  working: number;
  agents: number;
  spend: number;
  noIntegrations: boolean;
  recentActivity: HandoffListItem[];
  recentTasks: Task[];
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-muted-foreground flex items-center justify-between text-xs font-medium">
          {label}
          <Icon className="size-4" />
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {hint && <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  return <DashboardContent />;
}

function DashboardContent() {
  const router = useRouter();
  const { workspace } = useActiveWorkspace();
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const id = workspace.id;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    Promise.all([
      api.listTasks(id, { status: 'open' }),
      api.listTasks(id, { status: 'in_progress' }),
      api.listTasks(id, { status: 'blocked' }),
      api.listTasks(id),
      api.listHandoffs(id),
      api.getUsageSummary(id, { from: monthStart }),
      api.listAgents(id),
      api.listIntegrations(id),
    ])
      .then(([open, inProg, blocked, recent, handoffs, usage, agents, integrations]) => {
        const all = handoffs.handoffs;
        setData({
          open: open.total,
          inProgress: inProg.total,
          blocked: blocked.total,
          needsReview: all.filter((h) => h.state === 'needs_review').length,
          working: all.filter((h) => h.state === 'claimed' || h.state === 'in_progress').length,
          agents: agents.agents.length,
          spend: usage.totalCostUsd,
          noIntegrations: integrations.integrations.length === 0,
          recentActivity: [...all]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 8),
          recentTasks: recent.tasks.slice(0, 6),
        });
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/sign-in');
      });
  }, [workspace, router]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{greeting()}</h1>
        {workspace && (
          <p className="text-muted-foreground text-sm">Here is how {workspace.name} is doing.</p>
        )}
      </div>

      {/* Alert banners */}
      {data && (data.needsReview > 0 || data.noIntegrations) && (
        <div className="flex flex-col gap-2">
          {data.needsReview > 0 && (
            <Link
              href="/reviews"
              className="border-destructive/40 bg-destructive/5 hover:bg-destructive/10 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors"
            >
              <ClipboardCheck className="size-4 shrink-0" />
              {data.needsReview} {data.needsReview === 1 ? 'item needs' : 'items need'} your review.
              <span className="text-muted-foreground ml-auto">Go to Reviews</span>
            </Link>
          )}
          {data.noIntegrations && (
            <Link
              href="/settings"
              className="hover:bg-accent/50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors"
            >
              <TrendingUp className="size-4 shrink-0" />
              No integrations connected yet. Connect a source to start syncing tasks.
              <span className="text-muted-foreground ml-auto">Open Settings</span>
            </Link>
          )}
        </div>
      )}

      {/* Objectives progress strip (placeholder until Objectives ships) */}
      <Card className="border-dashed py-4">
        <CardContent className="flex items-center gap-3 px-4">
          <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
            <Target className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">Objectives</p>
            <p className="text-muted-foreground text-xs">
              Goal progress will appear here once Objectives are set up.
            </p>
          </div>
          <Link
            href="/objectives"
            className="text-muted-foreground hover:text-foreground ml-auto text-xs underline underline-offset-2"
          >
            Learn more
          </Link>
        </CardContent>
      </Card>

      {/* Stat cards */}
      {data === null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Tasks in progress"
            value={data.inProgress}
            hint={`${data.open} open · ${data.blocked} blocked`}
            icon={ListChecks}
          />
          <StatCard
            label="Needs review"
            value={data.needsReview}
            hint="agent tasks awaiting you"
            icon={ClipboardCheck}
          />
          <StatCard
            label="Spend this month"
            value={formatUsd(data.spend)}
            hint="across agent activity"
            icon={CircleDollarSign}
          />
          <StatCard
            label="Agents"
            value={data.agents}
            hint={`${data.working} working now`}
            icon={Bot}
          />
        </div>
      )}

      {/* Recent activity + recent tasks */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {data === null ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-5/6" />
              </div>
            ) : data.recentActivity.length === 0 ? (
              <p className="text-muted-foreground text-sm">No agent activity yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.recentActivity.map((h) => (
                  <li key={h.id} className="flex items-start gap-3 text-sm">
                    <Link
                      href={{ pathname: `/handoffs/${h.id}` }}
                      className="min-w-0 flex-1 hover:underline"
                    >
                      <span className="block truncate">{h.taskTitle ?? 'Task'}</span>
                      <span className="text-muted-foreground text-xs">
                        {HANDOFF_STATE_LABELS[h.state]} {'·'} {h.agentName ?? 'Agent'}
                      </span>
                    </Link>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {formatDateTime(h.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm">Recent tasks</CardTitle>
            <Link
              href="/tasks"
              className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {data === null ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-5/6" />
              </div>
            ) : data.recentTasks.length === 0 ? (
              <p className="text-muted-foreground text-sm">No tasks yet.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {data.recentTasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-3 text-sm">
                    <Badge
                      variant={STATUS_BADGE[task.status]}
                      className="w-20 shrink-0 justify-center"
                    >
                      {STATUS_LABELS[task.status]}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {formatDate(task.dueAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts placeholder (full charts arrive with the Agents dashboard, Phase 4) */}
      <Card className="border-dashed">
        <CardContent className="text-muted-foreground flex items-center gap-3 py-6 text-sm">
          <TrendingUp className="size-4 shrink-0" />
          Run activity and success-rate charts arrive with the Agents dashboard.
        </CardContent>
      </Card>
    </div>
  );
}
