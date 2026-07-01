'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  Invitation,
  InviteRole,
  MemberRole,
  MembershipStatus,
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
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { canManage } from '@/lib/roles';

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export function TeamCard({ workspace }: { workspace: Workspace }) {
  const { data: session } = useSession();
  const myId = session?.user.id;
  const manage = canManage(workspace.role);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [invites, setInvites] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleVal, setInviteRoleVal] = useState<InviteRole>('member');
  const [inviting, setInviting] = useState(false);

  const refresh = useCallback(() => {
    api.listMembers(workspace.id).then(({ members }) => setMembers(members));
    if (manage) {
      api.listInvites(workspace.id).then(({ invitations }) => setInvites(invitations));
    }
  }, [workspace.id, manage]);

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

  async function setStatus(userId: string, status: MembershipStatus) {
    if (
      status === 'inactive' &&
      !window.confirm('Deactivate this member? They keep their history but lose access.')
    ) {
      return;
    }
    setError(null);
    try {
      await api.setMemberStatus(workspace.id, userId, status);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update member');
    }
  }

  async function remove(userId: string) {
    if (
      !window.confirm('Remove this member from the workspace? This does not delete their account.')
    )
      return;
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
                <li
                  key={m.userId}
                  className={cn(
                    'flex flex-wrap items-center gap-3 px-3 py-2.5',
                    m.status === 'inactive' && 'opacity-60',
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {m.name ?? m.email}
                      {isSelf && <span className="text-muted-foreground"> (you)</span>}
                    </div>
                    {m.name && (
                      <div className="text-muted-foreground truncate text-xs">{m.email}</div>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {m.status === 'inactive' && <Badge variant="outline">Inactive</Badge>}
                    {manage && !isSelf ? (
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
                    {manage && !isSelf && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void setStatus(m.userId, m.status === 'active' ? 'inactive' : 'active')
                          }
                        >
                          {m.status === 'active' ? 'Deactivate' : 'Reactivate'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void remove(m.userId)}>
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {manage && (
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
