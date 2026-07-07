'use client';

import { AuthFrame } from '@/components/auth-frame';

import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { Workspace } from '@palouse/shared';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@palouse/ui';
import { api } from '@/lib/api';
import { authClient, useSession } from '@/lib/auth-client';

type OAuthRedirect = { redirect?: boolean; url?: string };

/**
 * Workspace selection step of the MCP OAuth connect flow
 * (docs/PLAN-mcp-oauth.md). The oauthProvider plugin redirects here after
 * sign-in with the signed authorization query in the URL; picking a workspace
 * stores the selection server-side, then /oauth2/continue resumes authorize,
 * which lands on the consent page.
 */
function WorkspaceSelect() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const clientId = useMemo(
    () =>
      typeof window === 'undefined'
        ? null
        : new URLSearchParams(window.location.search).get('client_id'),
    [],
  );

  // A session is normally guaranteed here (authorize redirects to sign-in
  // first); this covers a session that expired mid-flow.
  useEffect(() => {
    if (!isPending && !session) {
      router.replace(`/sign-in${window.location.search}` as Parameters<typeof router.replace>[0]);
    }
  }, [isPending, session, router]);

  useEffect(() => {
    if (!session) return;
    api
      .listWorkspaces()
      .then(({ workspaces }) => {
        const eligible = workspaces.filter((w) => w.role === 'owner' || w.role === 'admin');
        setWorkspaces(eligible);
        if (eligible.length === 1) setSelected(eligible[0]!.id);
      })
      .catch(() => setError('Could not load your workspaces. Reload to try again.'));
  }, [session]);

  useEffect(() => {
    if (!session || !clientId) return;
    authClient
      .$fetch('/oauth2/public-client', { query: { client_id: clientId } })
      .then((res) => {
        const client = res.data as { name?: string | null } | null;
        if (client?.name) setClientName(client.name);
      })
      .catch(() => {
        // Name is cosmetic; the flow still works without it.
      });
  }, [session, clientId]);

  async function onContinue() {
    if (!selected || !clientId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.selectMcpWorkspace({ workspaceId: selected, clientId });
      const res = await authClient.$fetch('/oauth2/continue', {
        method: 'POST',
        body: { postLogin: true },
      });
      const next = res.data as OAuthRedirect | null;
      if (next?.url) {
        window.location.href = next.url;
        return;
      }
      setError('The connection flow could not continue. Start over from your MCP client.');
      setSubmitting(false);
    } catch {
      setError('Something went wrong saving your selection. Try again.');
      setSubmitting(false);
    }
  }

  const appName = clientName ?? 'This app';

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Choose a workspace</CardTitle>
        <CardDescription>
          {appName} is connecting to Palouse. Pick the workspace it should work in.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {workspaces === null && !error && (
          <p className="text-muted-foreground text-sm">Loading workspaces…</p>
        )}
        {workspaces !== null && workspaces.length === 0 && (
          <p className="text-muted-foreground text-sm">
            You need the owner or admin role in a workspace to connect an agent. Ask a workspace
            admin to connect it, or to promote your role.
          </p>
        )}
        {workspaces !== null && workspaces.length > 0 && (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Workspace">
            {workspaces.map((w) => (
              <label
                key={w.id}
                className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                  selected === w.id ? 'border-primary bg-muted' : 'border-border'
                }`}
              >
                <input
                  type="radio"
                  name="workspace"
                  value={w.id}
                  checked={selected === w.id}
                  onChange={() => setSelected(w.id)}
                />
                <span className="font-medium">{w.name}</span>
                <span className="text-muted-foreground ml-auto capitalize">{w.role}</span>
              </label>
            ))}
          </div>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button onClick={onContinue} disabled={!selected || submitting}>
          {submitting ? 'Continuing…' : 'Continue'}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function McpConnectWorkspacePage() {
  return (
    <AuthFrame>
      <Suspense fallback={null}>
        <WorkspaceSelect />
      </Suspense>
    </AuthFrame>
  );
}
