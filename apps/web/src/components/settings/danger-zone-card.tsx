'use client';

import { useState, type FormEvent } from 'react';
import type { Workspace } from '@palouse/shared';
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
import { api, ApiError } from '@/lib/api';

export function DangerZoneCard({ workspace }: { workspace: Workspace }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    setSubmitting(true);
    try {
      await api.requestAccountDeletion(workspace.id, name.trim());
      setStatus({
        kind: 'ok',
        text: 'Check your email for a link to finish deleting this workspace. It expires in 1 hour.',
      });
      setName('');
      setOpen(false);
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'Could not start deletion.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>
          Deleting the workspace permanently removes everything in it: tasks, agents, integrations,
          and members. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status && (
          <p
            className={cn(
              'text-sm',
              status.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {status.text}
          </p>
        )}
        {!open ? (
          <div>
            <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
              Delete workspace
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="grid gap-2">
              <Label htmlFor="confirm-workspace-name">
                Type <span className="text-foreground font-semibold">{workspace.name}</span> to
                confirm
              </Label>
              <Input
                id="confirm-workspace-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <p className="text-muted-foreground text-xs">
              We will email you a confirmation link. The workspace is only deleted after you click
              it.
            </p>
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={submitting || name.trim() !== workspace.name}
              >
                {submitting ? 'Sending…' : 'Email me a confirmation link'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  setName('');
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
