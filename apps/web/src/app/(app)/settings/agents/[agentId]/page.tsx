'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { Agent, AgentApiKey, HandoffListItem, UsageSummaryRow } from '@palouse/shared';
import { Badge, Button, Card, CardContent, Skeleton } from '@palouse/ui';
import { ChevronLeft } from 'lucide-react';
import { AgentKeyDialog } from '@/components/agent-key-dialog';
import { MiniSpark } from '@/components/spend-charts';
import { api, ApiError } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { AGENT_KIND_LABELS, SCOPE_LABELS } from '@/lib/agent-meta';
import { HANDOFF_STATE_LABELS, formatDateTime, formatTokens, formatUsd } from '@/lib/handoff-meta';

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <div className="text-muted-foreground text-xs font-medium">{label}</div>
        <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function AgentDetailPage() {
  return <AgentDetailContent />;
}

function AgentDetailContent() {
  const router = useRouter();
  const params = useParams<{ agentId: string }>();
  const agentId = params.agentId;
  const { workspace } = useActiveWorkspace();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [keys, setKeys] = useState<AgentApiKey[] | null>(null);
  const [usage, setUsage] = useState<UsageSummaryRow | null>(null);
  const [spark, setSpark] = useState<{ date: string; cost: number }[] | null>(null);
  const [handoffs, setHandoffs] = useState<HandoffListItem[] | null>(null);

  const refresh = useCallback(() => {
    if (!workspace) return;
    const id = workspace.id;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    api
      .getAgent(id, agentId)
      .then(({ agent, keys }) => {
        setAgent(agent);
        setKeys(keys);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) router.replace('/settings/agents');
      });

    api
      .getUsageSummary(id, { from: monthStart, groupBy: 'agent' })
      .then(({ rows }) => setUsage(rows.find((r) => r.key === agentId) ?? null));

    const sparkFrom = new Date();
    sparkFrom.setDate(sparkFrom.getDate() - 30);
    api
      .getUsageSummary(id, { agentId, from: sparkFrom.toISOString(), groupBy: 'day' })
      .then(({ rows }) => setSpark(rows.map((r) => ({ date: r.key.slice(5), cost: r.costUsd }))));

    api
      .listHandoffs(id, { agentId })
      .then(({ handoffs }) =>
        setHandoffs(
          [...handoffs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8),
        ),
      );
  }, [workspace, agentId, router]);

  useEffect(refresh, [refresh]);

  const canManage = !!workspace && (workspace.role === 'owner' || workspace.role === 'admin');

  async function revoke(keyId: string) {
    if (!workspace) return;
    if (!window.confirm('Revoke this key? Any agent using it will lose access immediately.'))
      return;
    await api.revokeAgentKey(workspace.id, agentId, keyId);
    refresh();
  }

  async function restore() {
    if (!workspace) return;
    await api.unarchiveAgent(workspace.id, agentId);
    refresh();
  }

  // Tries the hard delete first; when the server refuses because the agent has
  // history, offers the archive fallback instead.
  async function remove() {
    if (!workspace) return;
    if (
      !window.confirm(
        'Remove this agent? If it has never done any work it is deleted; otherwise you can archive it.',
      )
    )
      return;
    try {
      await api.deleteAgent(workspace.id, agentId);
      router.replace('/settings/agents');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        if (
          window.confirm(
            'This agent has recorded activity, so it cannot be deleted. Archive it instead? Its keys are revoked and it is hidden from the list, but its history and spend records are kept.',
          )
        ) {
          await api.archiveAgent(workspace.id, agentId);
          refresh();
        }
      } else {
        throw err;
      }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/settings/agents"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
        >
          <ChevronLeft className="size-3.5" /> Agents
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">
            {agent ? agent.name : <Skeleton className="inline-block h-6 w-40" />}
          </h1>
          {agent && <Badge variant="outline">{AGENT_KIND_LABELS[agent.kind]}</Badge>}
          {agent?.archivedAt && <Badge variant="outline">Archived</Badge>}
          {agent?.archivedAt && canManage && (
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => void restore()}>
              Restore
            </Button>
          )}
        </div>
      </div>

      {/* Month usage */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Spend this month" value={formatUsd(usage?.costUsd ?? 0)} />
        <StatCard label="Generations" value={usage?.generationCount ?? 0} />
        <StatCard
          label="Tokens (in / out)"
          value={`${formatTokens(usage?.inputTokens ?? 0)} / ${formatTokens(usage?.outputTokens ?? 0)}`}
        />
      </div>

      {spark && spark.length > 0 && (
        <Card className="gap-2 py-4">
          <CardContent className="px-4">
            <div className="text-muted-foreground mb-1 text-xs font-medium">
              Spend, last 30 days
            </div>
            <MiniSpark data={spark} />
          </CardContent>
        </Card>
      )}

      {/* API keys */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">API keys</h2>
          <div className="ml-auto">
            {workspace && canManage && !agent?.archivedAt && (
              <AgentKeyDialog workspaceId={workspace.id} agentId={agentId} onCreated={refresh} />
            )}
          </div>
        </div>
        {agent?.archivedAt && (
          <p className="text-muted-foreground text-xs">
            Keys were revoked when this agent was archived. Restore it to create a new key.
          </p>
        )}

        <div className="rounded-lg border">
          {keys === null ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-5/6" />
            </div>
          ) : keys.length === 0 ? (
            <p className="text-muted-foreground p-8 text-center text-sm">
              No keys yet. Create one to connect this agent over MCP.
            </p>
          ) : (
            <ul className="divide-y">
              {keys.map((key) => (
                <li key={key.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <code className="bg-muted rounded px-1.5 py-0.5 text-xs">
                    palouse_agk_{key.prefix}…
                  </code>
                  <div className="flex flex-wrap gap-1">
                    {key.scopes.map((s) => (
                      <Badge key={s} variant="secondary" className="text-[10px]">
                        {SCOPE_LABELS[s] ?? s}
                      </Badge>
                    ))}
                  </div>
                  {key.revokedAt ? <Badge variant="outline">Revoked</Badge> : <Badge>Active</Badge>}
                  <span className="text-muted-foreground ml-auto text-xs">
                    last used: {formatDateTime(key.lastUsedAt)}
                  </span>
                  {!key.revokedAt && canManage && (
                    <Button variant="ghost" size="sm" onClick={() => void revoke(key.id)}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Recent activity */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Recent activity</h2>
        <div className="rounded-lg border">
          {handoffs === null ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-5/6" />
            </div>
          ) : handoffs.length === 0 ? (
            <p className="text-muted-foreground p-8 text-center text-sm">
              No tasks handed to this agent yet.
            </p>
          ) : (
            <ul className="divide-y">
              {handoffs.map((h) => (
                <li key={h.id}>
                  <Link
                    href={{ pathname: `/handoffs/${h.id}` }}
                    className="hover:bg-accent/50 flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">{h.taskTitle ?? 'Task'}</span>
                    <Badge variant="outline" className="shrink-0">
                      {HANDOFF_STATE_LABELS[h.state]}
                    </Badge>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {formatDateTime(h.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {canManage && agent && !agent.archivedAt && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Remove</h2>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border p-4">
            <p className="text-muted-foreground min-w-0 flex-1 text-xs">
              An agent that has never done any work is deleted outright. One with recorded
              activity is archived instead: keys are revoked and it is hidden from the list, but
              its history and spend records are kept.
            </p>
            <Button variant="outline" size="sm" onClick={() => void remove()}>
              Remove agent
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
