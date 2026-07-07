'use client';

import { useState, type FormEvent } from 'react';
import type { Agent, AgentKeyScope, AgentKind } from '@palouse/shared';
import { agentKind, ALL_AGENT_KEY_SCOPES, WILDCARD_SCOPE } from '@palouse/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@palouse/ui';
import { AgentKeyReveal, CopyButton } from '@/components/agent-key-reveal';
import { AgentScopePicker } from '@/components/agent-scope-picker';
import { api, ApiError } from '@/lib/api';
import { AGENT_KIND_LABELS } from '@/lib/agent-meta';
import {
  MCP_URL,
  MCP_URL_PLACEHOLDER,
  mcpEndpoint,
  oauthConnectCommand,
  oauthHttpConfigSnippet,
} from '@/lib/mcp';

type Mode = 'signin' | 'key';

/**
 * Two ways to connect a client to this workspace:
 *  - Sign in (recommended): the user pastes the MCP endpoint into their client
 *    and signs in with their Palouse credentials. No key to copy; the agent is
 *    created by the OAuth flow and appears in the list afterward.
 *  - API key (advanced): register the agent and mint a key here, for clients
 *    that do not speak OAuth or for self-hosted stdio setups.
 */
export function ConnectAgentDialog({
  workspaceId,
  onConnected,
  onDone,
}: {
  workspaceId: string;
  /** Fired as soon as a key-based agent exists, so lists can refresh behind the dialog. */
  onConnected?: (agent: Agent) => void;
  /** Fired when the user closes the key reveal step. */
  onDone?: (agent: Agent) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AgentKind>('mcp_generic');
  const [fullAccess, setFullAccess] = useState(true);
  const [scopes, setScopes] = useState<AgentKeyScope[]>([...ALL_AGENT_KEY_SCOPES]);
  const [created, setCreated] = useState<{ agent: Agent; plaintext: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setMode('signin');
    setName('');
    setKind('mcp_generic');
    setFullAccess(true);
    setScopes([...ALL_AGENT_KEY_SCOPES]);
    setCreated(null);
    setError(null);
    setSubmitting(false);
  }

  function toggle(scope: AgentKeyScope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  const canSubmit = name.trim().length > 0 && (fullAccess || scopes.length > 0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { agent } = await api.createAgent(workspaceId, { name, kind });
      onConnected?.(agent);
      const payload: AgentKeyScope[] = fullAccess ? [WILDCARD_SCOPE] : scopes;
      const { plaintext } = await api.createAgentKey(workspaceId, agent.id, { scopes: payload });
      setCreated({ agent, plaintext });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to connect agent');
    } finally {
      setSubmitting(false);
    }
  }

  function close() {
    const done = created;
    setOpen(false);
    reset();
    if (done) onDone?.(done.agent);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close();
        } else {
          setOpen(true);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Connect agent</Button>
      </DialogTrigger>
      <DialogContent>
        {created !== null ? (
          <>
            <DialogHeader>
              <DialogTitle>{created.agent.name} is ready to connect</DialogTitle>
              <DialogDescription>
                This is the only time the full key is shown. Copy it now, then use a snippet below
                to finish the connection.
              </DialogDescription>
            </DialogHeader>
            <AgentKeyReveal plaintext={created.plaintext} />
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Connect an agent</DialogTitle>
              <DialogDescription>Connect any MCP client to this workspace.</DialogDescription>
            </DialogHeader>

            <div className="bg-muted flex gap-1 rounded-md p-1">
              {(['signin', 'key'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                    mode === m
                      ? 'bg-background shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {m === 'signin' ? 'Sign in' : 'API key'}
                </button>
              ))}
            </div>

            {mode === 'signin' ? (
              <div className="flex flex-col gap-4">
                <p className="text-muted-foreground text-sm">
                  Add this endpoint to your MCP client and run it. You get sent to Palouse to sign
                  in and confirm this workspace, then the client is connected. It shows up here once
                  you finish.
                </p>
                <div className="grid gap-2">
                  <Label>MCP endpoint</Label>
                  <code className="bg-muted block overflow-x-auto rounded-md px-3 py-2 text-xs">
                    {mcpEndpoint()}
                  </code>
                  <CopyButton value={mcpEndpoint()} label="Copy endpoint" />
                </div>
                <div className="grid gap-2">
                  <Label>Connect Claude Code</Label>
                  <pre className="bg-muted overflow-x-auto rounded-md px-3 py-2 text-xs whitespace-pre-wrap break-all">
                    {oauthConnectCommand()}
                  </pre>
                  <CopyButton value={oauthConnectCommand()} label="Copy command" />
                </div>
                <div className="grid gap-2">
                  <Label>Other MCP clients (HTTP)</Label>
                  <pre className="bg-muted overflow-x-auto rounded-md px-3 py-2 text-xs">
                    {oauthHttpConfigSnippet()}
                  </pre>
                  <CopyButton value={oauthHttpConfigSnippet()} label="Copy config" />
                </div>
                {!MCP_URL && (
                  <p className="text-muted-foreground text-xs">
                    Replace {MCP_URL_PLACEHOLDER} with your instance&apos;s MCP endpoint.
                  </p>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={close}>
                    Done
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="flex flex-col gap-4">
                <p className="text-muted-foreground text-sm">
                  Mint a key for a client that cannot sign in through the browser, or for a
                  self-hosted stdio setup. Name the agent and choose what it can do.
                </p>
                <div className="grid gap-2">
                  <Label htmlFor="agent-name">Name</Label>
                  <Input
                    id="agent-name"
                    required
                    maxLength={200}
                    placeholder="e.g. Claude Code (local)"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Kind</Label>
                  <Select value={kind} onValueChange={(v) => setKind(v as AgentKind)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {agentKind.options.map((k) => (
                        <SelectItem key={k} value={k}>
                          {AGENT_KIND_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <AgentScopePicker
                  fullAccess={fullAccess}
                  onFullAccessChange={setFullAccess}
                  scopes={scopes}
                  onToggleScope={toggle}
                />
                {error && <p className="text-destructive text-sm">{error}</p>}
                <DialogFooter>
                  <Button type="submit" disabled={submitting || !canSubmit}>
                    {submitting ? 'Connecting…' : 'Connect with a key'}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
