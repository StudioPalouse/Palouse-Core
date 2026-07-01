'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  Agent,
  Integration,
  Invitation,
  InviteRole,
  MemberRole,
  Workspace,
  WorkspaceMember,
} from '@palouse/shared';
import { inviteRole, memberRole } from '@palouse/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@palouse/ui';
import { AppShell } from '@/components/app-shell';
import { NewAgentDialog } from '@/components/new-agent-dialog';
import { api, ApiError, oauthStartUrl } from '@/lib/api';
import { AGENT_KIND_LABELS } from '@/lib/agent-meta';
import { useSession, updateUser, changePassword } from '@/lib/auth-client';

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

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

function TaskSourcesPanel({ workspace }: { workspace: Workspace }) {
  const searchParams = useSearchParams();
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canManage = workspace.role === 'owner' || workspace.role === 'admin';

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
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Connect the external systems your team uses for human tasks. Google Tasks is polled every
        60s; Asana uses webhooks when reachable, with a 5-minute polling fallback.
      </p>
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
              {canManage && (
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

      {canManage && (
        <div className="flex flex-wrap gap-2">
          {CONNECTABLE.map((provider) => (
            <Button key={provider} variant="outline" size="sm" asChild>
              <a href={oauthStartUrl(provider, workspace.id)}>Connect {PROVIDER_LABELS[provider]}</a>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentConnectionsPanel({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const canManage = workspace.role === 'owner' || workspace.role === 'admin';

  const refresh = useCallback(() => {
    api.listAgents(workspace.id).then(({ agents }) => setAgents(agents));
  }, [workspace.id]);

  useEffect(refresh, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Agents connect over MCP using an API key. Register an agent, mint a key, then add it to the
        agent&apos;s MCP config (for example Claude Code or Claude Desktop).
      </p>
      {agents !== null && agents.length > 0 && (
        <ul className="divide-y rounded-md border">
          {agents.map((agent) => (
            <li key={agent.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="text-sm font-medium">{agent.name}</span>
              <Badge variant="outline">{AGENT_KIND_LABELS[agent.kind]}</Badge>
              <Link
                href={{ pathname: `/agents/${agent.id}` }}
                className="text-muted-foreground hover:text-foreground ml-auto text-xs underline underline-offset-2"
              >
                Manage keys
              </Link>
            </li>
          ))}
        </ul>
      )}
      {agents !== null && agents.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No agents yet. Create one to connect Claude Code, Paperclip, or a custom MCP agent.
        </p>
      )}
      {canManage && (
        <div>
          <NewAgentDialog
            workspaceId={workspace.id}
            onCreated={(agent) => router.push(`/agents/${agent.id}`)}
          />
        </div>
      )}
    </div>
  );
}

const CONNECTION_TABS = [
  { key: 'human', label: 'Task sources' },
  { key: 'agent', label: 'Agent connections' },
] as const;

function ConnectionsCard({ workspace }: { workspace: Workspace }) {
  const [tab, setTab] = useState<'human' | 'agent'>('human');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connections</CardTitle>
        <CardDescription>
          Connect the human task sources your team uses and the agents that work alongside them.
        </CardDescription>
        <div className="mt-2 flex items-center gap-1 border-b">
          {CONNECTION_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                tab === t.key
                  ? 'border-foreground text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground border-transparent',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {tab === 'human' ? (
          <TaskSourcesPanel workspace={workspace} />
        ) : (
          <AgentConnectionsPanel workspace={workspace} />
        )}
      </CardContent>
    </Card>
  );
}

function TeamCard({ workspace }: { workspace: Workspace }) {
  const { data: session } = useSession();
  const myId = session?.user.id;
  const canManage = workspace.role === 'owner' || workspace.role === 'admin';
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [invites, setInvites] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleVal, setInviteRoleVal] = useState<InviteRole>('member');
  const [inviting, setInviting] = useState(false);

  const refresh = useCallback(() => {
    api.listMembers(workspace.id).then(({ members }) => setMembers(members));
    if (canManage) {
      api.listInvites(workspace.id).then(({ invitations }) => setInvites(invitations));
    }
  }, [workspace.id, canManage]);

  useEffect(refresh, [refresh]);

  async function changeRole(userId: string, role: MemberRole) {
    setError(null);
    try {
      await api.updateMemberRole(workspace.id, userId, role);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update role');
    }
  }

  async function remove(userId: string) {
    if (!window.confirm('Remove this member from the workspace?')) return;
    setError(null);
    try {
      await api.removeMember(workspace.id, userId);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove member');
    }
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError(null);
    try {
      await api.createInvite(workspace.id, { email: inviteEmail.trim(), role: inviteRoleVal });
      setInviteEmail('');
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send invite');
    } finally {
      setInviting(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    setError(null);
    try {
      await api.revokeInvite(workspace.id, inviteId);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke invite');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>People with access to this workspace and their roles.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-destructive text-sm">{error}</p>}
        {members === null ? (
          <p className="text-muted-foreground text-sm">Loading members…</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {members.map((m) => {
              const isSelf = m.userId === myId;
              return (
                <li key={m.userId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {m.name ?? m.email}
                      {isSelf && <span className="text-muted-foreground"> (you)</span>}
                    </div>
                    {m.name && <div className="text-muted-foreground truncate text-xs">{m.email}</div>}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {canManage && !isSelf ? (
                      <Select
                        value={m.role}
                        onValueChange={(v) => void changeRole(m.userId, v as MemberRole)}
                      >
                        <SelectTrigger size="sm" className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {memberRole.options.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline">{ROLE_LABELS[m.role]}</Badge>
                    )}
                    {canManage && !isSelf && (
                      <Button variant="ghost" size="sm" onClick={() => void remove(m.userId)}>
                        Remove
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {canManage && (
          <div className="flex flex-col gap-3 border-t pt-4">
            <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="invite-email" className="text-xs">
                  Invite by email
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  placeholder="teammate@company.com"
                  className="h-8 w-64"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <Select value={inviteRoleVal} onValueChange={(v) => setInviteRoleVal(v as InviteRole)}>
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {inviteRole.options.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" size="sm" disabled={inviting || !inviteEmail.trim()}>
                {inviting ? 'Sending…' : 'Send invite'}
              </Button>
            </form>

            {invites && invites.length > 0 && (
              <ul className="divide-y rounded-md border">
                {invites.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <span className="text-sm">{inv.email}</span>
                    <Badge variant="outline">{ROLE_LABELS[inv.role]}</Badge>
                    <Badge variant="secondary">Pending</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => void revokeInvite(inv.id)}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AccountCard() {
  const { data: session } = useSession();
  const [name, setName] = useState('');
  const [nameLoaded, setNameLoaded] = useState(false);
  const [nameStatus, setNameStatus] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwStatus, setPwStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  // Seed the name field once the session resolves; don't clobber later edits.
  useEffect(() => {
    if (!nameLoaded && session?.user.name != null) {
      setName(session.user.name);
      setNameLoaded(true);
    }
  }, [session, nameLoaded]);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setNameStatus(null);
    setNameSaving(true);
    const { error } = await updateUser({ name: name.trim() });
    setNameSaving(false);
    setNameStatus(error ? (error.message ?? 'Could not save your name.') : 'Saved.');
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setPwStatus(null);
    if (newPassword !== confirmPassword) {
      setPwStatus({ kind: 'error', text: 'New passwords do not match.' });
      return;
    }
    setPwSaving(true);
    // revokeOtherSessions signs out this account's other devices after a change.
    const { error } = await changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setPwSaving(false);
    if (error) {
      setPwStatus({ kind: 'error', text: error.message ?? 'Could not change your password.' });
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPwStatus({ kind: 'ok', text: 'Password changed.' });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Your profile and sign-in details.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form onSubmit={saveName} className="flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="account-name">Display name</Label>
            <Input
              id="account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="account-email">Email</Label>
            <Input id="account-email" value={session?.user.email ?? ''} disabled readOnly />
            <p className="text-muted-foreground text-xs">Your email address cannot be changed.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={nameSaving || !name.trim()}>
              {nameSaving ? 'Saving…' : 'Save'}
            </Button>
            {nameStatus && <span className="text-muted-foreground text-sm">{nameStatus}</span>}
          </div>
        </form>

        <div className="border-t" />

        <form onSubmit={submitPassword} className="flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-new-password">Confirm new password</Label>
            <Input
              id="confirm-new-password"
              type="password"
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              size="sm"
              disabled={pwSaving || !currentPassword || !newPassword || !confirmPassword}
            >
              {pwSaving ? 'Changing…' : 'Change password'}
            </Button>
            {pwStatus && (
              <span
                className={cn(
                  'text-sm',
                  pwStatus.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {pwStatus.text}
              </span>
            )}
          </div>
        </form>
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
      <AccountCard />
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
      {workspace && <TeamCard workspace={workspace} />}
      {workspace && <ConnectionsCard workspace={workspace} />}
      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
          <CardDescription>
            Turn product areas on or off for your team based on your plan. Per-area enable and
            disable controls are coming soon.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
            {['Dashboard', 'Objectives', 'Projects', 'Tasks', 'Decisions', 'Context'].map(
              (area) => (
                <li key={area} className="flex items-center justify-between">
                  <span>{area}</span>
                  <Badge variant="outline">Coming soon</Badge>
                </li>
              ),
            )}
          </ul>
        </CardContent>
      </Card>
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
