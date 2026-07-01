'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Agent } from '@palouse/shared';
import { Badge, Skeleton } from '@palouse/ui';
import { ChevronRight } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { AgentsTabs } from '@/components/agents-tabs';
import { NewAgentDialog } from '@/components/new-agent-dialog';
import { api } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { AGENT_KIND_LABELS } from '@/lib/agent-meta';
import { formatUsd } from '@/lib/handoff-meta';

type AgentRow = { agent: Agent; tasks: number; spend: number };

export default function AgentsPage() {
  return (
    <AppShell>
      <AgentsContent />
    </AppShell>
  );
}

function AgentsContent() {
  const router = useRouter();
  const { workspace } = useActiveWorkspace();
  const [rows, setRows] = useState<AgentRow[] | null>(null);

  const refresh = useCallback(() => {
    if (!workspace) return;
    const id = workspace.id;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    Promise.all([
      api.listAgents(id),
      api.getUsageSummary(id, { from: monthStart, groupBy: 'agent' }),
      api.listHandoffs(id),
    ]).then(([{ agents }, usage, { handoffs }]) => {
      const spendByAgent = new Map(usage.rows.map((r) => [r.key, r.costUsd]));
      const tasksByAgent = new Map<string, number>();
      for (const h of handoffs) {
        tasksByAgent.set(h.actorAgentId, (tasksByAgent.get(h.actorAgentId) ?? 0) + 1);
      }
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">
          Agents
          {workspace && (
            <span className="text-muted-foreground ml-2 text-sm font-normal">{workspace.name}</span>
          )}
        </h1>
        <div className="ml-auto">
          {workspace && (workspace.role === 'owner' || workspace.role === 'admin') && (
            <NewAgentDialog
              workspaceId={workspace.id}
              onCreated={(agent) => router.push(`/agents/${agent.id}`)}
            />
          )}
        </div>
      </div>

      <AgentsTabs />

      <div className="rounded-lg border">
        {rows === null ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground p-8 text-center text-sm">
            No agents yet. Create one to connect Claude Code, Paperclip, or a custom MCP agent.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map(({ agent, tasks, spend }) => (
              <li key={agent.id}>
                <Link
                  href={{ pathname: `/agents/${agent.id}` }}
                  className="hover:bg-accent/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.name}</span>
                  <Badge variant="outline">{AGENT_KIND_LABELS[agent.kind]}</Badge>
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
