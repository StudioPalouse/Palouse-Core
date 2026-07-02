'use client';

import { AuthFrame } from '@/components/auth-frame';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@palouse/ui';
import { authClient } from '@/lib/auth-client';

const MIN_PASSWORD_LENGTH = 8;

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Better-Auth redirects here with ?token=… on success, or ?error=… if the
  // link was invalid/expired.
  const token = params.get('token');
  const linkError = params.get('error');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!token || linkError) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          This reset link is invalid or has expired. Request a new one and try again.
        </p>
        <Link
          href="/forgot-password"
          className="text-foreground text-center text-sm underline underline-offset-4"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token: token! });
    if (error) {
      setError(error.message ?? 'Could not reset your password');
      setSubmitting(false);
      return;
    }
    router.push('/sign-in?reset=1');
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Updating…' : 'Update password'}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthFrame>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
          <CardDescription>Enter and confirm your new password.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
            <ResetPasswordForm />
          </Suspense>
        </CardContent>
      </Card>
    </AuthFrame>
  );
}
