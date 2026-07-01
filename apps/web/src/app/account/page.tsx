'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Input,
  Label,
} from '@palouse/ui';
import { AppShell } from '@/components/app-shell';
import { useSession, updateUser, changePassword } from '@/lib/auth-client';
import { resizeImageToDataUrl } from '@/lib/image';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // reject large source files before resizing

export default function AccountPage() {
  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Account settings</h1>
        <ProfileCard />
        <SecurityCard />
        <AppearanceCard />
      </div>
    </AppShell>
  );
}

function ProfileCard() {
  const { data: session } = useSession();
  const [name, setName] = useState('');
  const [nameLoaded, setNameLoaded] = useState(false);
  const [nameStatus, setNameStatus] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your name, photo, and sign-in email.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <AvatarField
          image={session?.user.image ?? null}
          initial={(session?.user.email ?? '?').charAt(0).toUpperCase()}
        />

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
      </CardContent>
    </Card>
  );
}

function AvatarField({ image, initial }: { image: string | null; initial: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('That image is too large. Please choose one under 5 MB.');
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      const { error: updateError } = await updateUser({ image: dataUrl });
      if (updateError) setError(updateError.message ?? 'Could not save your photo.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process the image.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    const { error: updateError } = await updateUser({ image: '' });
    if (updateError) setError(updateError.message ?? 'Could not remove your photo.');
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Profile photo</Label>
      <div className="flex items-center gap-4">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- data-URL avatar, no loader needed
          <img src={image} alt="" className="size-16 rounded-full object-cover" />
        ) : (
          <span className="bg-primary text-primary-foreground flex size-16 items-center justify-center rounded-full text-xl font-medium">
            {initial}
          </span>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? 'Saving…' : image ? 'Change photo' : 'Upload photo'}
            </Button>
            {image && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove}>
                Remove
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-xs">JPG or PNG, up to 5 MB.</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFile}
        />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}

function SecurityCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwStatus, setPwStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

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
        <CardTitle>Security</CardTitle>
        <CardDescription>Change the password you use to sign in.</CardDescription>
      </CardHeader>
      <CardContent>
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

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const active = mounted ? theme : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Choose how Palouse looks on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              type="button"
              variant={active === value ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setTheme(value)}
            >
              <Icon className="size-4" /> {label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
