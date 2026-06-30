'use client';

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
import { signIn } from '@/lib/auth-client';

/** Confirmation shown after a completed password reset redirects back here. */
function ResetSuccessNotice() {
  const reset = useSearchParams().get('reset');
  if (!reset) return null;
  return (
    <p className="bg-muted text-muted-foreground mb-4 rounded-md px-3 py-2 text-sm">
      Your password has been reset. Sign in with your new password.
    </p>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await signIn.email({ email, password });
    if (error) {
      // Unverified accounts are blocked (403) and Better-Auth re-sends the link.
      const notVerified = error.status === 403 || /verif/i.test(error.message ?? '');
      setError(
        notVerified
          ? 'Verify your email before signing in. We just sent a new verification link to your inbox.'
          : (error.message ?? 'Sign in failed'),
      );
      setSubmitting(false);
      return;
    }
    router.push('/inbox');
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Palouse</CardTitle>
          <CardDescription>Use your email and password.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <ResetSuccessNotice />
          </Suspense>
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
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-muted-foreground text-sm underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
            <p className="text-muted-foreground text-center text-sm">
              No account?{' '}
              <Link href="/sign-up" className="text-foreground underline underline-offset-4">
                Sign up
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
