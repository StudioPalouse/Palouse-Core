'use client';

import { AuthFrame } from '@/components/auth-frame';

import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { ALL_AGENT_KEY_SCOPES, type AgentKeyScope } from '@palouse/shared';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@palouse/ui';
import { SCOPE_LABELS } from '@/lib/agent-meta';
import { api } from '@/lib/api';
import { authClient, useSession } from '@/lib/auth-client';

type OAuthRedirect = { redirect?: boolean; url?: string };

// OIDC scopes a generic client may request alongside the agent scopes.
const OIDC_SCOPE_LABELS: Record<string, string> = {
  openid: 'Confirm your identity',
  profile: 'View your name',
  email: 'View your email address',
  offline_access: 'Stay connected without signing in again',
};

function scopeLabel(scope: string): string {
  return SCOPE_LABELS[scope as AgentKeyScope] ?? OIDC_SCOPE_LABELS[scope] ?? scope;
}

// The scopes that decide which MCP tools the connection can call, so the only
// ones worth choosing between. The OIDC scopes above are shown but not
// toggleable: dropping `openid` would break the id_token, and none of them
// grant access to workspace data.
const AGENT_SCOPES = new Set<string>(ALL_AGENT_KEY_SCOPES);

/**
 * Consent step of the MCP OAuth connect flow (docs/PLAN-mcp-oauth.md).
 * Approving calls /oauth2/consent, which records the grant against the agent
 * chosen on the workspace step and sends the browser back to the client with
 * an authorization code.
 */
function Consent() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [clientName, setClientName] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null);

  const params = useMemo(
    () =>
      typeof window === 'undefined'
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search),
    [],
  );
  const clientId = params.get('client_id');
  const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean);
  const agentScopes = scopes.filter((s) => AGENT_SCOPES.has(s));
  const otherScopes = scopes.filter((s) => !AGENT_SCOPES.has(s));

  // Tracks what the user switched off rather than what is on. Untouched then
  // means "grant everything requested", with no dependence on the query string
  // being readable on the first render, which it is not during SSR.
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  const granted = scopes.filter((s) => !declined.has(s));
  const grantedAgentScopes = agentScopes.filter((s) => !declined.has(s));
  // A connection with no agent scope can call no tools, and the token it mints
  // carries no workspace, so the MCP server rejects every request it makes.
  const nothingGranted = agentScopes.length > 0 && grantedAgentScopes.length === 0;

  function toggleScope(scope: string) {
    setDeclined((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  useEffect(() => {
    if (!isPending && !session) {
      router.replace(`/sign-in${window.location.search}` as Parameters<typeof router.replace>[0]);
    }
  }, [isPending, session, router]);

  useEffect(() => {
    if (!session) return;
    api
      .getMcpSelection()
      .then(({ selection }) => setWorkspaceName(selection?.workspaceName ?? null))
      .catch(() => {
        // Workspace name is informational; consent still works without it.
      });
    if (!clientId) return;
    authClient
      .$fetch('/oauth2/public-client', { query: { client_id: clientId } })
      .then((res) => {
        const client = res.data as { name?: string | null } | null;
        if (client?.name) setClientName(client.name);
      })
      .catch(() => {
        // Same: cosmetic only.
      });
  }, [session, clientId]);

  async function decide(accept: boolean) {
    setSubmitting(accept ? 'approve' : 'deny');
    setError(null);
    try {
      const res = await authClient.$fetch('/oauth2/consent', {
        method: 'POST',
        // `scope` is omitted unless something was switched off. The provider
        // then grants the originally requested set, which is exactly what this
        // screen did before scope selection existed.
        body:
          accept && granted.length < scopes.length
            ? { accept, scope: granted.join(' ') }
            : { accept },
      });
      const next = res.data as OAuthRedirect | null;
      if (next?.url) {
        window.location.href = next.url;
        return;
      }
      setError('The connection flow could not continue. Start over from your MCP client.');
      setSubmitting(null);
    } catch {
      setError('Something went wrong. Try again.');
      setSubmitting(null);
    }
  }

  const appName = clientName ?? 'This app';

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Allow access?</CardTitle>
        <CardDescription>
          {appName} wants to connect to
          {workspaceName ? ` the ${workspaceName} workspace` : ' your Palouse workspace'}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {agentScopes.length > 0 && (
          <div>
            <p className="text-muted-foreground mb-2 text-sm">Choose what it can do:</p>
            <div className="flex flex-col gap-2" role="group" aria-label="Permissions">
              {agentScopes.map((s) => (
                <label
                  key={s}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                    declined.has(s) ? 'border-border' : 'border-primary bg-muted'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!declined.has(s)}
                    onChange={() => toggleScope(s)}
                    disabled={submitting !== null}
                  />
                  <span>{scopeLabel(s)}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {otherScopes.length > 0 && (
          <div>
            <p className="text-muted-foreground mb-2 text-sm">It will also:</p>
            <ul className="flex flex-col gap-1 text-sm">
              {otherScopes.map((s) => (
                <li key={s} className="flex items-center gap-2">
                  <span className="bg-primary inline-block size-1.5 rounded-full" />
                  {scopeLabel(s)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {nothingGranted && (
          <p className="text-muted-foreground text-sm">
            Keep at least one permission selected. A connection with none cannot do anything.
          </p>
        )}
        <p className="text-muted-foreground text-sm">
          The connection shows up under Settings, Agents. You can revoke it there at any time.
        </p>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => decide(false)}
            disabled={submitting !== null}
          >
            {submitting === 'deny' ? 'Denying…' : 'Deny'}
          </Button>
          <Button
            className="flex-1"
            onClick={() => decide(true)}
            disabled={submitting !== null || nothingGranted}
          >
            {submitting === 'approve' ? 'Approving…' : 'Approve'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function McpConnectConsentPage() {
  return (
    <AuthFrame>
      <Suspense fallback={null}>
        <Consent />
      </Suspense>
    </AuthFrame>
  );
}
