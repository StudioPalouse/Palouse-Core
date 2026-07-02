'use client';

import { AuthFrame } from '@/components/auth-frame';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    // The reset email links back to /reset-password?token=… (Better-Auth appends
    // the token after validating its callback endpoint).
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: '/reset-password',
    });
    setSubmitting(false);
    if (error) {
      setError(error.message ?? 'Could not send the reset email');
      return;
    }
    // Always show the same confirmation regardless of whether the account
    // exists — avoids leaking which emails are registered.
    setSent(true);
  }

  return (
    <AuthFrame>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            {sent
              ? 'Check your inbox for a reset link.'
              : 'Enter your email and we’ll send you a reset link.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="flex flex-col gap-4">
              <p className="text-muted-foreground text-sm">
                If an account exists for <span className="text-foreground">{email}</span>, a
                password reset link is on its way. The link expires after a short while.
              </p>
              <Link
                href="/sign-in"
                className="text-foreground text-center text-sm underline underline-offset-4"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send reset link'}
              </Button>
              <p className="text-muted-foreground text-center text-sm">
                Remembered it?{' '}
                <Link href="/sign-in" className="text-foreground underline underline-offset-4">
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthFrame>
  );
}
