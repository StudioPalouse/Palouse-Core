'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Integration, Workspace } from '@reqops/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@reqops/ui';
import { AppShell } from '@/components/app-shell';
import { api, oauthStartUrl } from '@/lib/api';

const PROVIDER_LABELS: Record<string, string> = {
  google_tasks: 'Google Tasks',
  asana: 'Asana',
  ms_todo: 'Microsoft To Do',
  ms_planner: 'Microsoft Planner',
};

const CONNECTABLE = ['google_tasks', 'asana'] as const;

function formatTime(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function IntegrationsCard({ workspace }: { workspace: Workspace }) {
  const searchParams = useSearchParams();
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const connected = searchParams.get('connected');
  const error = searchParams.get('error');

  const refresh = useCallback(() => {
    api.listIntegrations(workspace.id).then(({ integrations }) => setIntegrations(integrations));
  }, [workspace.id]);

  useEffect(refresh, [refresh]);

  async function syncNow(id: string) {
    await api.syncIntegration(workspace.id, id);
    setNotice('Sync queued — tasks appear in the inbox as the worker pulls them.');
  }

  async function disconnect(id: string) {
    await api.deleteIntegration(workspace.id, id);
    refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>
          Connect external task systems. Google Tasks is polled every 60s; Asana uses webhooks
          when reachable, with a 5-minute polling fallback.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {connected && (
          <p className="rounded-md border px-3 py-2 text-sm">
            Connected {PROVIDER_LABELS[connected] ?? connected}. First sync is queued.
          </p>
        )}
        {error && (
          <p className="text-destructive rounded-md border px-3 py-2 text-sm">
            Connection failed ({error}). Check the provider OAuth env vars and try again.
          </p>
        )}
        {notice && <p className="text-muted-foreground text-sm">{notice}</p>}

        {integrations !== null && integrations.length > 0 && (
          <ul className="divide-y rounded-md border">
            {integrations.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="text-sm font-medium">
                  {PROVIDER_LABELS[it.provider] ?? it.provider}
                </span>
                <span className="text-muted-foreground text-xs">{it.accountLabel}</span>
                <Badge
                  variant={
                    it.status === 'active'
                      ? 'secondary'
                      : it.status === 'degraded'
                        ? 'destructive'
                        : 'outline'
                  }
                >
                  {it.status}
                </Badge>
                <span className="text-muted-foreground ml-auto text-xs">
                  last sync: {formatTime(it.lastSyncAt)}
                </span>
                <Button variant="outline" size="sm" onClick={() => void syncNow(it.id)}>
                  Sync now
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void disconnect(it.id)}>
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          {CONNECTABLE.map((provider) => (
            <Button key={provider} variant="outline" size="sm" asChild>
              <a href={oauthStartUrl(provider, workspace.id)}>
                Connect {PROVIDER_LABELS[provider]}
              </a>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsContent() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  useEffect(() => {
    api.listWorkspaces().then(({ workspaces }) => setWorkspaces(workspaces));
  }, []);

  const workspace = workspaces[0];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Workspaces</CardTitle>
          <CardDescription>Workspaces you belong to.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {workspaces.map((ws) => (
              <li key={ws.id} className="flex items-center justify-between text-sm">
                <span>{ws.name}</span>
                <span className="text-muted-foreground text-xs">
                  {ws.slug} · {ws.role}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {workspace && <IntegrationsCard workspace={workspace} />}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AppShell>
      <Suspense>
        <SettingsContent />
      </Suspense>
    </AppShell>
  );
}
