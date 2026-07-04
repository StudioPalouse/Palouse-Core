'use client';

import { useCallback, useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type {
  Invitation,
  MemberRole,
  MembershipStatus,
  Workspace,
  WorkspaceMember,
} from '@palouse/shared';
import { memberRole } from '@palouse/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@palouse/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { canManage, ROLE_LABELS } from '@/lib/roles';
import { ConfirmDialog, type ConfirmRequest } from '@/components/confirm-dialog';
import { InviteMemberDialog } from '@/components/settings/invite-member-dialog';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0];
  const second = parts[1]?.[0];
  if (first && second) return (first + second).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function MemberAvatar({ name, email, muted }: { name: string | null; email: string; muted?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        'bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium',
        muted && 'border border-dashed bg-transparent',
      )}
    >
      {initials(name, email)}
    </div>
  );
}

export function TeamCard({ workspace }: { workspace: Workspace }) {
  const { data: session } = useSession();
  const myId = session?.user.id;
  const manage = canManage(workspace.role);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [invites, setInvites] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const refresh = useCallback(() => {
    api.listMembers(workspace.id).then(({ members }) => setMembers(members));
    if (manage) {
      api.listInvites(workspace.id).then(({ invitations }) => setInvites(invitations));
    }
  }, [workspace.id, manage]);

  useEffect(refresh, [refresh]);

  async function run(action: () => Promise<unknown>, failMessage: string) {
    setError(null);
    try {
      await action();
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failMessage);
    }
  }

  function changeRole(userId: string, role: MemberRole) {
    void run(() => api.updateMemberRole(workspace.id, userId, role), 'Failed to update role');
  }

  function setStatus(member: WorkspaceMember, status: MembershipStatus) {
    if (status === 'active') {
      void run(
        () => api.setMemberStatus(workspace.id, member.userId, status),
        'Failed to update member',
      );
      return;
    }
    setConfirm({
      title: 'Deactivate member?',
      description: `${member.name ?? member.email} will lose access to this workspace. Their tasks and history are kept, and you can reactivate them at any time.`,
      actionLabel: 'Deactivate',
      destructive: true,
      run: () =>
        run(
          () => api.setMemberStatus(workspace.id, member.userId, status),
          'Failed to update member',
        ),
    });
  }

  function remove(member: WorkspaceMember) {
    setConfirm({
      title: 'Remove member?',
      description: `${member.name ?? member.email} will be removed from this workspace. This does not delete their account.`,
      actionLabel: 'Remove',
      destructive: true,
      run: () => run(() => api.removeMember(workspace.id, member.userId), 'Failed to remove member'),
    });
  }

  function revokeInvite(invite: Invitation) {
    setConfirm({
      title: 'Revoke invitation?',
      description: `The invitation sent to ${invite.email} will no longer work.`,
      actionLabel: 'Revoke',
      destructive: true,
      run: () => run(() => api.revokeInvite(workspace.id, invite.id), 'Failed to revoke invite'),
    });
  }

  const loading = members === null;
  const activeCount = members?.filter((m) => m.status === 'active').length ?? 0;
  const pendingCount = invites?.length ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Team</CardTitle>
          <CardDescription>
            {loading
              ? 'People with access to this workspace and their roles.'
              : `${activeCount} active ${activeCount === 1 ? 'member' : 'members'}${
                  pendingCount > 0
                    ? `, ${pendingCount} pending ${pendingCount === 1 ? 'invite' : 'invites'}`
                    : ''
                }.`}
          </CardDescription>
        </div>
        {manage && <InviteMemberDialog workspaceId={workspace.id} onInvited={refresh} />}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-destructive text-sm">{error}</p>}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Member</TableHead>
                <TableHead className="w-36">Role</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-32">Joined</TableHead>
                {manage && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                Array.from({ length: 3 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Skeleton className="size-8 rounded-full" />
                        <div className="flex flex-col gap-1.5">
                          <Skeleton className="h-3.5 w-36" />
                          <Skeleton className="h-3 w-48" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-14" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    {manage && <TableCell />}
                  </TableRow>
                ))}

              {members?.map((m) => {
                const isSelf = m.userId === myId;
                const inactive = m.status === 'inactive';
                return (
                  <TableRow key={m.userId} className={cn(inactive && 'opacity-60')}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <MemberAvatar name={m.name} email={m.email} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {m.name ?? m.email}
                            {isSelf && <span className="text-muted-foreground"> (you)</span>}
                          </div>
                          {m.name && (
                            <div className="text-muted-foreground truncate text-xs">{m.email}</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {manage && !isSelf ? (
                        <Select
                          value={m.role}
                          onValueChange={(v) => changeRole(m.userId, v as MemberRole)}
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
                    </TableCell>
                    <TableCell>
                      <Badge variant={inactive ? 'outline' : 'secondary'}>
                        {inactive ? 'Inactive' : 'Active'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(m.joinedAt)}</TableCell>
                    {manage && (
                      <TableCell className="text-right">
                        {!isSelf && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-8">
                                <MoreHorizontal />
                                <span className="sr-only">Member actions</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() => setStatus(m, inactive ? 'active' : 'inactive')}
                              >
                                {inactive ? 'Reactivate' : 'Deactivate'}
                              </DropdownMenuItem>
                              <DropdownMenuItem variant="destructive" onSelect={() => remove(m)}>
                                Remove from workspace
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}

              {manage &&
                invites?.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <MemberAvatar name={null} email={inv.email} muted />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{inv.email}</div>
                          <div className="text-muted-foreground truncate text-xs">
                            Invited {formatDate(inv.createdAt)}, expires {formatDate(inv.expiresAt)}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ROLE_LABELS[inv.role]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">Invited</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">–</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8">
                            <MoreHorizontal />
                            <span className="sr-only">Invitation actions</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem variant="destructive" onSelect={() => revokeInvite(inv)}>
                            Revoke invitation
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </Card>
  );
}
