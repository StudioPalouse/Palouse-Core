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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@palouse/ui';
import { adminConsentUrl, api, oauthStartUrl } from '@/lib/api';
import { canManage } from '@/lib/roles';

const PROVIDER_LABELS: Record<string, string> = {
  google_tasks: 'Google Tasks',
  asana: 'Asana',
  ms_tasks: 'Microsoft Tasks',
  // Legacy per-product Microsoft connections (pre-unification rows).
  ms_todo: 'Microsoft To Do',
  ms_planner: 'Microsoft Planner',
};

/** Connectors offered in the Add connection flow. */
const CATALOG: { provider: string; label: string; description: string }[] = [
  {
    provider: 'ms_tasks',
    label: 'Microsoft Tasks',
    description:
      'Microsoft To Do and Planner tasks through one sign-in. Planner requires a work or school account.',
  },
  {
    provider: 'google_tasks',
    label: 'Google Tasks',
    description: 'Tasks from your Google account, checked every minute.',
  },
  {
    provider: 'asana',
    label: 'Asana',
    description: 'Tasks from your Asana workspace, updated as they change.',
  },
];

/**
 * Shown when Entra blocked the sign-in because the tenant requires admin
 * approval for new apps. Hand-holds the user to their IT admin instead of
 * presenting a dead-end failure.
 */
function AdminConsentHelp() {
  const [copied, setCopied] = useState(false);
  const approvalLink = adminConsentUrl('ms_tasks');
  const mailtoHref = `mailto:?subject=${encodeURIComponent(
    'Approve Palouse for our Microsoft 365 organization',
  )}&body=${encodeURIComponent(
    'Hi,\n\n' +
      "I'm connecting our team's tasks to Palouse and Microsoft says the app needs admin approval for our organization.\n\n" +
      'Could you approve it? Open this link and sign in with your admin account:\n\n' +
      `${approvalLink}\n\n` +
      'It only asks for access to read and update tasks (Microsoft To Do and Planner).\n\nThanks!',
  )}`;

  async function copyLink() {
    await navigator.clipboard.writeText(approvalLink);
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border px-3 py-3 text-sm">
      <p className="font-medium">Your organization needs to approve Palouse first</p>
      <p className="text-muted-foreground">
        Your company limits which apps can access Microsoft 365. If the Microsoft screen showed a
        &quot;Request approval&quot; box, that is the fastest path. Otherwise, send your IT admin
        the approval link below: one click approves Palouse for your whole organization, and then
        anyone on your team can connect.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void copyLink()}>
          {copied ? 'Copied' : 'Copy approval link'}
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href={mailtoHref}>Email your IT admin</a>
        </Button>
      </div>
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ConnectionRow({
  integration,
  manage,
  onSync,
  onDisconnect,
}: {
  integration: Integration;
  manage: boolean;
  onSync: (id: string) => void;
  onDisconnect: (id: string) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {PROVIDER_LABELS[integration.provider] ?? integration.provider}
        </p>
        <p className="text-muted-foreground truncate text-xs">{integration.accountLabel}</p>
      </div>
      <Badge
        variant={
          integration.status === 'active'
            ? 'secondary'
            : integration.status === 'degraded'
              ? 'destructive'
              : 'outline'
        }
      >
        {integration.status}
      </Badge>
      <span className="text-muted-foreground ml-auto text-xs">
        last sync: {formatTime(integration.lastSyncAt)}
      </span>
      {manage && (
        <>
          <Button variant="outline" size="sm" onClick={() => onSync(integration.id)}>
            Sync now
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDisconnect(integration.id)}>
            Disconnect
          </Button>
        </>
      )}
    </li>
  );
}

function AddConnectionDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a connection</DialogTitle>
          <DialogDescription>
            Pick the service your team uses for tasks. You will be sent there to sign in and
            approve access. If your company restricts new apps, we will walk you through
            requesting approval.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-md border">
          {CATALOG.map((entry) => (
            <li key={entry.provider} className="flex items-center gap-3 px-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{entry.label}</p>
                <p className="text-muted-foreground text-xs">{entry.description}</p>
              </div>
              <Button variant="outline" size="sm" className="ml-auto shrink-0" asChild>
                <a href={oauthStartUrl(entry.provider, workspaceId)}>Connect</a>
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function IntegrationsCard({ workspace }: { workspace: Workspace }) {
  const searchParams = useSearchParams();
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const manage = canManage(workspace.role);

  const connected = searchParams.get('connected');
  const error = searchParams.get('error');
  const adminConsentGranted = searchParams.get('admin_consent') === 'granted';

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
          Active connections to the task services your team already uses. Tasks from each
          connection flow into your inbox and stay in sync.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {connected && (
          <p className="rounded-md border px-3 py-2 text-sm">
            Connected {PROVIDER_LABELS[connected] ?? connected}. First sync is queued.
          </p>
        )}
        {adminConsentGranted && (
          <p className="rounded-md border px-3 py-2 text-sm">
            Palouse is approved for your organization. Connect Microsoft Tasks to finish setup.
          </p>
        )}
        {error === 'ms_admin_consent' && <AdminConsentHelp />}
        {error && error !== 'ms_admin_consent' && (
          <p className="text-destructive rounded-md border px-3 py-2 text-sm">
            Connection failed ({error}). Check the provider OAuth env vars and try again.
          </p>
        )}
        {notice && <p className="text-muted-foreground text-sm">{notice}</p>}

        {integrations === null && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}

        {integrations !== null && integrations.length > 0 && (
          <>
            <ul className="divide-y rounded-md border">
              {integrations.map((it) => (
                <ConnectionRow
                  key={it.id}
                  integration={it}
                  manage={manage}
                  onSync={(id) => void syncNow(id)}
                  onDisconnect={(id) => void disconnect(id)}
                />
              ))}
            </ul>
            {manage && (
              <div>
                <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                  Add connection
                </Button>
              </div>
            )}
          </>
        )}

        {integrations !== null && integrations.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-6 py-10 text-center">
            <p className="text-sm font-medium">No connections yet</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              Connect a task service to bring your team&apos;s existing work into Palouse.
            </p>
            {manage ? (
              <Button size="sm" className="mt-2" onClick={() => setAddOpen(true)}>
                Add connection
              </Button>
            ) : (
              <p className="text-muted-foreground text-xs">
                Ask a workspace owner or admin to add one.
              </p>
            )}
          </div>
        )}

        <AddConnectionDialog
          workspaceId={workspace.id}
          open={addOpen}
          onOpenChange={setAddOpen}
        />
      </CardContent>
    </Card>
  );
}
