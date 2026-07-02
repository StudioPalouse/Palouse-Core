'use client';

import { AuthFrame } from '@/components/auth-frame';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@palouse/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/auth-client';

function InviteAccept() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const { data: session, isPending } = useSession();
  const [status, setStatus] = useState<'idle' | 'accepting' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isPending || !token || !session || status !== 'idle') return;
    setStatus('accepting');
    api
      .acceptInvite(token)
      .then(() => {
        setStatus('done');
        setTimeout(() => router.replace('/dashboard'), 900);
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err instanceof ApiError ? err.message : 'Could not accept this invitation');
      });
  }, [isPending, token, session, status, router]);

  if (!token) {
    return (
      <>
        <CardHeader>
          <CardTitle>Invalid invitation</CardTitle>
          <CardDescription>This invitation link is missing its token.</CardDescription>
        </CardHeader>
      </>
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
    const next = encodeURIComponent(`/invite?token=${token}`);
    return (
      <>
        <CardHeader>
          <CardTitle>You have been invited</CardTitle>
          <CardDescription>
            Sign in or create an account to accept this invitation. You will land back here
            automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild>
            <Link href={`/sign-in?next=${next}`}>Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/sign-up?next=${next}`}>Create an account</Link>
          </Button>
        </CardContent>
      </>
    );
  }

  return (
    <>
      <CardHeader>
        <CardTitle>
          {status === 'done' ? 'You are in' : status === 'error' ? 'Invitation problem' : 'Accepting…'}
        </CardTitle>
        <CardDescription>
          {status === 'done'
            ? 'Taking you to your dashboard.'
            : status === 'error'
              ? message
              : 'Adding you to the workspace.'}
        </CardDescription>
      </CardHeader>
      {status === 'error' && (
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </CardContent>
      )}
    </>
  );
}

export default function InvitePage() {
  return (
    <AuthFrame>
      <Card className="w-full max-w-sm">
        <Suspense fallback={null}>
          <InviteAccept />
        </Suspense>
      </Card>
    </AuthFrame>
  );
}
