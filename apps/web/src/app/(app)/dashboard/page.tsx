'use client';

import { useCallback, useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DecisionListItem, ObjectiveListItem, Task, TaskStatus } from '@palouse/shared';
import { Badge, Card, CardContent, CardHeader, CardTitle, cn, Skeleton } from '@palouse/ui';
import { Bot, ClipboardCheck, ListChecks, Scale, Target, TrendingUp } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { HANDOFF_STATE_LABELS, formatDateTime } from '@/lib/handoff-meta';
import { DECISION_STATUS_LABELS } from '@/lib/decision-meta';
import { OBJECTIVE_STATUS_LABELS, OBJECTIVE_STATUS_TONE } from '@/lib/objective-meta';
import { ProgressBar } from '@/components/objective-list';
import { Horizon } from '@/components/fieldwork/horizon';
import { STATUS_LABELS, formatDate } from '@/lib/task-meta';

const STATUS_BADGE: Record<TaskStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  open: 'outline',
  in_progress: 'default',
  blocked: 'destructive',
  done: 'secondary',
  archived: 'secondary',
};

// Agents change tasks, decisions, and objectives server-side with nothing to
// signal the client, so the dashboard polls to pick up their changes.
const POLL_MS = 20_000;

/** A normalized entry in the unified recent-activity feed (tasks + decisions). */
type ActivityItem = {
  id: string;
  title: string;
  subtitle: string;
  timestamp: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

type DashboardData = {
  open: number;
  inProgress: number;
  blocked: number;
  needsReview: number;
  working: number;
  agents: number;
  noIntegrations: boolean;
  decisionsTotal: number;
  decisionsUnderReview: number;
  openDecisionsAtRisk: number;
  projectsWithProposedDecisions: number;
  objectivesTotal: number;
  objectivesProgress: number;
  topObjectives: ObjectiveListItem[];
  recentActivity: ActivityItem[];
  recentTasks: Task[];
  recentDecisions: DecisionListItem[];
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
    <Card className="relative gap-2 overflow-hidden py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-muted-foreground flex items-center justify-between text-xs font-medium">
          {label}
          <Icon className="size-4" />
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        {hint && <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>}
      </CardContent>
      <Horizon className="h-10" />
    </Card>
  );
}

export default function DashboardPage() {
  return <DashboardContent />;
}

function DashboardContent() {
  const router = useRouter();
  const { workspace, capabilities } = useActiveWorkspace();
  const [data, setData] = useState<DashboardData | null>(null);

  // Unknown (null) capabilities read as enabled so the dashboard does not flash
  // empty before the map loads, matching the nav's fail-open convention.
  const showTasks = capabilities?.tasks ?? true;
  const showDecisions = capabilities?.decisions ?? true;
  const showObjectives = capabilities?.objectives ?? true;
  const showProjects = capabilities?.projects ?? true;

  const load = useCallback(() => {
    if (!workspace) return;
    const id = workspace.id;

    // Fetch only what the enabled capabilities need, all in parallel.
    const tasksReq = showTasks
      ? Promise.all([
          api.listTasks(id, { status: 'open' }),
          api.listTasks(id, { status: 'in_progress' }),
          api.listTasks(id, { status: 'blocked' }),
          api.listTasks(id),
          api.listHandoffs(id),
          api.listIntegrations(id),
        ])
      : Promise.resolve(null);
    const decisionsReq = showDecisions
      ? api.listDecisions(id, { limit: 50 })
      : Promise.resolve(null);
    const objectivesReq = showObjectives
      ? api.listObjectives(id, { limit: 50 })
      : Promise.resolve(null);
    // Strategy signals cross-reference decisions with at-risk goals and projects;
    // the endpoint zeroes each count when its supporting capability is off.
    const signalsReq = showDecisions ? api.getStrategySignals(id) : Promise.resolve(null);
    const agentsReq = api.listAgents(id);

    Promise.all([tasksReq, decisionsReq, objectivesReq, signalsReq, agentsReq])
      .then(([taskData, decisionData, objectiveData, signals, agents]) => {
        const handoffs = taskData ? taskData[4].handoffs : [];
        const decisions = decisionData ? decisionData.decisions : [];
        const objectives = objectiveData ? objectiveData.objectives : [];

        const activity: ActivityItem[] = [
          ...handoffs.map((h) => ({
            id: `handoff:${h.id}`,
            title: h.taskTitle ?? 'Task',
            subtitle: `${HANDOFF_STATE_LABELS[h.state]} · ${h.agentName ?? 'Agent'}`,
            timestamp: h.updatedAt,
            href: `/handoffs/${h.id}`,
            icon: Bot,
          })),
          ...decisions.map((d) => ({
            id: `decision:${d.id}`,
            title: d.title,
            subtitle: d.area
              ? `${DECISION_STATUS_LABELS[d.status]} · ${d.area}`
              : DECISION_STATUS_LABELS[d.status],
            timestamp: d.updatedAt,
            href: '/decisions',
            icon: Scale,
          })),
          ...objectives.map((o) => ({
            id: `objective:${o.id}`,
            title: o.title,
            subtitle: o.area
              ? `${OBJECTIVE_STATUS_LABELS[o.status]} · ${o.area}`
              : OBJECTIVE_STATUS_LABELS[o.status],
            timestamp: o.updatedAt,
            href: '/objectives',
            icon: Target,
          })),
        ]
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .slice(0, 8);

        // Overall goal progress averages only objectives that have key results,
        // so goals still being set up do not drag the number to zero.
        const measured = objectives.filter((o) => o.keyResultCount > 0);
        const objectivesProgress = measured.length
          ? Math.round(measured.reduce((sum, o) => sum + o.progress, 0) / measured.length)
          : 0;

        setData({
          open: taskData ? taskData[0].total : 0,
          inProgress: taskData ? taskData[1].total : 0,
          blocked: taskData ? taskData[2].total : 0,
          needsReview: handoffs.filter((h) => h.state === 'needs_review').length,
          working: handoffs.filter((h) => h.state === 'claimed' || h.state === 'in_progress')
            .length,
          agents: agents.agents.length,
          noIntegrations: taskData ? taskData[5].integrations.length === 0 : false,
          decisionsTotal: decisionData ? decisionData.total : 0,
          decisionsUnderReview: decisions.filter((d) => d.status === 'under_review').length,
          openDecisionsAtRisk: signals ? signals.openDecisionsOnAtRiskObjectives : 0,
          projectsWithProposedDecisions: signals ? signals.projectsWithProposedDecisions : 0,
          objectivesTotal: objectiveData ? objectiveData.total : 0,
          objectivesProgress,
          topObjectives: objectives.slice(0, 4),
          recentActivity: activity,
          recentTasks: taskData ? taskData[3].tasks.slice(0, 6) : [],
          recentDecisions: [...decisions]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 6),
        });
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/sign-in');
      });
  }, [workspace, router, showTasks, showDecisions, showObjectives, showProjects]);

  // Load on mount / workspace change, then poll so changes surface on their own.
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="stagger-rise flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{greeting()}</h1>
        {workspace && (
          <p className="text-muted-foreground text-sm">Here is how {workspace.name} is doing.</p>
        )}
      </div>

      {/* Alert banners */}
      {data &&
        (data.needsReview > 0 ||
          data.noIntegrations ||
          (showObjectives && data.openDecisionsAtRisk > 0) ||
          (showProjects && data.projectsWithProposedDecisions > 0)) && (
          <div className="flex flex-col gap-2">
            {data.needsReview > 0 && (
              <Link
                href="/reviews"
                className="border-destructive/40 bg-destructive/5 hover:bg-destructive/10 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors"
              >
                <ClipboardCheck className="size-4 shrink-0" />
                {data.needsReview} {data.needsReview === 1 ? 'item needs' : 'items need'} your
                review.
                <span className="text-muted-foreground ml-auto">Go to Reviews</span>
              </Link>
            )}
            {showObjectives && data.openDecisionsAtRisk > 0 && (
              <Link
                href="/decisions"
                className="hover:bg-accent/50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors"
              >
                <Scale className="size-4 shrink-0" />
                {data.openDecisionsAtRisk} open{' '}
                {data.openDecisionsAtRisk === 1 ? 'decision' : 'decisions'} on at-risk goals.
                <span className="text-muted-foreground ml-auto">Go to Decisions</span>
              </Link>
            )}
            {showProjects && data.projectsWithProposedDecisions > 0 && (
              <Link
                href="/projects"
                className="hover:bg-accent/50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors"
              >
                <Scale className="size-4 shrink-0" />
                {data.projectsWithProposedDecisions}{' '}
                {data.projectsWithProposedDecisions === 1 ? 'project has' : 'projects have'}{' '}
                proposed decisions awaiting a call.
                <span className="text-muted-foreground ml-auto">Go to Projects</span>
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

      {/* Objectives progress: real goal progress once objectives exist. */}
      {showObjectives &&
        (data === null ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : data.objectivesTotal === 0 ? (
          <Card className="border-dashed py-4">
            <CardContent className="flex items-center gap-3 px-4">
              <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
                <Target className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">Objectives</p>
                <p className="text-muted-foreground text-xs">
                  Set a goal your team is working toward and its progress shows up here.
                </p>
              </div>
              <Link
                href="/objectives"
                className="text-muted-foreground hover:text-foreground ml-auto text-xs underline underline-offset-2"
              >
                Get started
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Target className="size-4" />
                Objectives
              </CardTitle>
              <Link
                href="/objectives"
                className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
              >
                View all
              </Link>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground w-24 shrink-0 text-xs">
                  {data.objectivesTotal} {data.objectivesTotal === 1 ? 'goal' : 'goals'}
                </span>
                <ProgressBar value={data.objectivesProgress} className="flex-1" />
              </div>
              <ul className="flex flex-col gap-2.5">
                {data.topObjectives.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 text-sm">
                    <span
                      className={cn(
                        'inline-flex w-20 shrink-0 justify-center rounded-md px-2 py-0.5 text-xs font-medium',
                        OBJECTIVE_STATUS_TONE[o.status],
                      )}
                    >
                      {OBJECTIVE_STATUS_LABELS[o.status]}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.title}</span>
                    {o.keyResultCount > 0 ? (
                      <ProgressBar value={o.progress} className="w-32 shrink-0" />
                    ) : (
                      <span className="text-muted-foreground w-32 shrink-0 text-right text-xs">
                        No key results
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}

      {/* Stat cards, driven by the workspace's enabled capabilities */}
      {data === null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {showTasks && (
            <>
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
            </>
          )}
          {showDecisions && (
            <StatCard
              label="Decisions"
              value={data.decisionsTotal}
              hint={`${data.decisionsUnderReview} under review`}
              icon={Scale}
            />
          )}
          <StatCard
            label="Agents"
            value={data.agents}
            hint={`${data.working} working now`}
            icon={Bot}
          />
        </div>
      )}

      {/* Recent activity + recent tasks/decisions */}
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
              <p className="text-muted-foreground text-sm">No activity yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.recentActivity.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 text-sm">
                    <item.icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                    <Link href={{ pathname: item.href }} className="min-w-0 flex-1 hover:underline">
                      <span className="block truncate">{item.title}</span>
                      <span className="text-muted-foreground text-xs">{item.subtitle}</span>
                    </Link>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {formatDateTime(item.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Prefer recent tasks; fall back to recent decisions when tasks are off. */}
        {showTasks ? (
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
        ) : showDecisions ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-sm">Recent decisions</CardTitle>
              <Link
                href="/decisions"
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
              ) : data.recentDecisions.length === 0 ? (
                <p className="text-muted-foreground text-sm">No decisions yet.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {data.recentDecisions.map((decision) => (
                    <li key={decision.id} className="flex items-center gap-3 text-sm">
                      <Badge variant="outline" className="w-24 shrink-0 justify-center">
                        {DECISION_STATUS_LABELS[decision.status]}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate">{decision.title}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {formatDate(decision.updatedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}
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
