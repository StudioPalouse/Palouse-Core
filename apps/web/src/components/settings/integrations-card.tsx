'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Integration, Workspace } from '@palouse/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@palouse/ui';
import { api, oauthStartUrl } from '@/lib/api';
import { canManage } from '@/lib/roles';

const PROVIDER_LABELS: Record<string, string> = {
  google_tasks: 'Google Tasks',
  asana: 'Asana',
  ms_todo: 'Microsoft To Do',
  ms_planner: 'Microsoft Planner',
};

const CONNECTABLE = ['google_tasks', 'asana', 'ms_todo', 'ms_planner'] as const;

function formatTime(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function IntegrationsCard({ workspace }: { workspace: Workspace }) {
  const searchParams = useSearchParams();
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const manage = canManage(workspace.role);

  const connected = searchParams.get('connected');
  const error = searchParams.get('error');

  const refresh = useCallback(() => {
    api.listIntegrations(workspace.id).then(({ integrations }) => setIntegrations(integrations));
  }, [workspace.id]);

  useEffect(refresh, [refresh]);

  async function syncNow(id: string) {
    await api.syncIntegration(workspace.id, id);
    setNotice('Sync queued. Tasks appear in the inbox as the worker pulls them.');
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
          Connect the external systems your team uses for human tasks. Google Tasks is polled every
          60s; Asana uses webhooks when reachable, with a 5-minute polling fallback.
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
                {manage && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => void syncNow(it.id)}>
                      Sync now
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void disconnect(it.id)}>
                      Disconnect
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {manage && (
          <div className="flex flex-wrap gap-2">
            {CONNECTABLE.map((provider) => (
              <Button key={provider} variant="outline" size="sm" asChild>
                <a href={oauthStartUrl(provider, workspace.id)}>Connect {PROVIDER_LABELS[provider]}</a>
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
