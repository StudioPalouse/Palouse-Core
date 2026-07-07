'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Agent } from '@palouse/shared';
import { Badge, Label, Skeleton, Switch } from '@palouse/ui';
import { ChevronRight } from 'lucide-react';
import { AgentsTabs } from '@/components/agents-tabs';
import { ConnectAgentDialog } from '@/components/connect-agent-dialog';
import { api } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { canManage } from '@/lib/roles';
import { AGENT_KIND_LABELS, isOAuthAgent } from '@/lib/agent-meta';
import { formatUsd } from '@/lib/handoff-meta';

type AgentRow = { agent: Agent; tasks: number; spend: number };

export default function AgentsPage() {
  return <AgentsContent />;
}

function AgentsContent() {
  const router = useRouter();
  const { workspace } = useActiveWorkspace();
  const [rows, setRows] = useState<AgentRow[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [hasArchived, setHasArchived] = useState(false);

  const refresh = useCallback(() => {
    if (!workspace) return;
    const id = workspace.id;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    Promise.all([
      api.listAgents(id, { includeArchived: true }),
      api.getUsageSummary(id, { from: monthStart, groupBy: 'agent' }),
      api.listHandoffs(id),
    ]).then(([{ agents }, usage, { handoffs }]) => {
      const spendByAgent = new Map(usage.rows.map((r) => [r.key, r.costUsd]));
      const tasksByAgent = new Map<string, number>();
      for (const h of handoffs) {
        tasksByAgent.set(h.actorAgentId, (tasksByAgent.get(h.actorAgentId) ?? 0) + 1);
      }
      setHasArchived(agents.some((a) => a.archivedAt !== null));
      setRows(
        agents.map((agent) => ({
          agent,
          tasks: tasksByAgent.get(agent.id) ?? 0,
          spend: spendByAgent.get(agent.id) ?? 0,
        })),
      );
    });
  }, [workspace]);

  useEffect(refresh, [refresh]);

  const visible = rows?.filter((r) => showArchived || r.agent.archivedAt === null) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Agents
            {workspace && (
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                {workspace.name}
              </span>
            )}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Agents are external tools connected to Palouse over MCP. Each gets its own key, spend
            tracking, and activity history.
          </p>
        </div>
        <div className="ml-auto">
          {workspace && canManage(workspace.role) && (
            <ConnectAgentDialog
              workspaceId={workspace.id}
              onConnected={refresh}
              onDone={(agent) => router.push(`/settings/agents/${agent.id}`)}
            />
          )}
        </div>
      </div>

      <AgentsTabs />

      {hasArchived && (
        <div className="flex items-center gap-2 self-end">
          <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show-archived" className="text-muted-foreground text-xs font-normal">
            Show archived
          </Label>
        </div>
      )}

      <div className="rounded-lg border">
        {visible === null ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
          </div>
        ) : visible.length === 0 ? (
          <p className="text-muted-foreground p-8 text-center text-sm">
            {rows && rows.length > 0
              ? 'No active agents. Turn on "Show archived" to see archived ones.'
              : 'Nothing connected yet. Connect Claude Code or any MCP client to work with the tasks and decisions in this workspace.'}
          </p>
        ) : (
          <ul className="divide-y">
            {visible.map(({ agent, tasks, spend }) => (
              <li key={agent.id}>
                <Link
                  href={{ pathname: `/settings/agents/${agent.id}` }}
                  className="hover:bg-accent/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.name}</span>
                  {agent.archivedAt !== null && <Badge variant="outline">Archived</Badge>}
                  <Badge variant="outline">
                    {isOAuthAgent(agent) ? 'Sign-in' : AGENT_KIND_LABELS[agent.kind]}
                  </Badge>
                  <span className="text-muted-foreground hidden w-28 text-right text-xs sm:inline">
                    {tasks} {tasks === 1 ? 'task' : 'tasks'}
                  </span>
                  <span className="text-muted-foreground w-24 text-right text-xs">
                    {formatUsd(spend)} this mo.
                  </span>
                  <ChevronRight className="text-muted-foreground size-4" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
