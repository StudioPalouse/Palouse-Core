'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@palouse/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/auth-client';

function ConfirmDeletion() {
  const token = useSearchParams().get('token');
  const { data: session, isPending } = useSession();
  const [status, setStatus] = useState<'idle' | 'deleting' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function confirm() {
    if (!token) return;
    setStatus('deleting');
    try {
      await api.confirmWorkspaceDeletion(token);
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof ApiError ? err.message : 'Could not delete this workspace');
    }
  }

  if (!token) {
    return (
      <CardHeader>
        <CardTitle>Invalid link</CardTitle>
        <CardDescription>This deletion link is missing its token.</CardDescription>
      </CardHeader>
    );
  }

  if (isPending) {
    return (
      <CardHeader>
        <CardTitle>Loading…</CardTitle>
      </CardHeader>
    );
  }

  if (!session) {
    const next = encodeURIComponent(`/workspaces/delete?token=${token}`);
    return (
      <>
        <CardHeader>
          <CardTitle>Confirm workspace deletion</CardTitle>
          <CardDescription>
            Sign in to confirm. You will land back here automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href={`/sign-in?next=${next}`}>Sign in</Link>
          </Button>
        </CardContent>
      </>
    );
  }

  if (status === 'done') {
    return (
      <>
        <CardHeader>
          <CardTitle>Workspace deleted</CardTitle>
          <CardDescription>
            The workspace and everything in it has been permanently removed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/dashboard">Continue</Link>
          </Button>
        </CardContent>
      </>
    );
  }

  return (
    <>
      <CardHeader>
        <CardTitle className="text-destructive">Delete this workspace?</CardTitle>
        <CardDescription>
          This permanently removes the workspace and everything in it: tasks, agents, integrations,
          and members. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status === 'error' && <p className="text-destructive text-sm">{message}</p>}
        <div className="flex gap-2">
          <Button
            variant="destructive"
            disabled={status === 'deleting'}
            onClick={() => void confirm()}
          >
            {status === 'deleting' ? 'Deleting…' : 'Delete permanently'}
          </Button>
          <Button asChild variant="ghost">
            <Link href="/settings/organization">Cancel</Link>
          </Button>
        </div>
      </CardContent>
    </>
  );
}

export default function WorkspaceDeletePage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <Suspense fallback={null}>
          <ConfirmDeletion />
        </Suspense>
      </Card>
    </main>
  );
}
