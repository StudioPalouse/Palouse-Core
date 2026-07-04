'use client';

import { useState } from 'react';
import type { AgentKeyScope } from '@palouse/shared';
import { ALL_AGENT_KEY_SCOPES } from '@palouse/shared';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Label,
} from '@palouse/ui';
import { Check, Copy } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { SCOPE_LABELS } from '@/lib/agent-meta';

// Baked at build time (fly/web*.toml build args). Empty in self-hosted builds
// that have not set NEXT_PUBLIC_MCP_URL; the UI shows a placeholder then.
const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL ?? '';
const MCP_URL_PLACEHOLDER = 'https://your-palouse-host/mcp';

function claudeCodeSnippet(plaintext: string): string {
  const url = MCP_URL || MCP_URL_PLACEHOLDER;
  return `claude mcp add --transport http palouse ${url} --header "Authorization: Bearer ${plaintext}"`;
}

function httpConfigSnippet(plaintext: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        palouse: {
          type: 'http',
          url: MCP_URL || MCP_URL_PLACEHOLDER,
          headers: { Authorization: `Bearer ${plaintext}` },
        },
      },
    },
    null,
    2,
  );
}

function stdioConfigSnippet(plaintext: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        palouse: {
          command: 'palouse-mcp',
          args: ['--stdio'],
          env: { PALOUSE_API_KEY: plaintext },
        },
      },
    },
    null,
    2,
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable; user can select manually */
        }
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function AgentKeyDialog({
  workspaceId,
  agentId,
  onCreated,
}: {
  workspaceId: string;
  agentId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [scopes, setScopes] = useState<AgentKeyScope[]>([...ALL_AGENT_KEY_SCOPES]);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setScopes([...ALL_AGENT_KEY_SCOPES]);
    setPlaintext(null);
    setError(null);
    setSubmitting(false);
  }

  function toggle(scope: AgentKeyScope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function create() {
    if (scopes.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const { plaintext } = await api.createAgentKey(workspaceId, agentId, { scopes });
      setPlaintext(plaintext);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create key');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Create key</Button>
      </DialogTrigger>
      <DialogContent>
        {plaintext === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Choose what this key can do. You can revoke it at any time.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label>Scopes</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_AGENT_KEY_SCOPES.map((scope) => {
                  const on = scopes.includes(scope);
                  return (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => toggle(scope)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs transition-colors',
                        on
                          ? 'bg-primary text-primary-foreground border-transparent'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {SCOPE_LABELS[scope]}
                    </button>
                  );
                })}
              </div>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <DialogFooter>
              <Button onClick={() => void create()} disabled={submitting || scopes.length === 0}>
                {submitting ? 'Creating…' : 'Create key'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Copy your API key now</DialogTitle>
              <DialogDescription>
                This is the only time the full key is shown. Store it somewhere safe.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label>API key</Label>
                <code className="bg-muted block overflow-x-auto rounded-md px-3 py-2 text-xs">
                  {plaintext}
                </code>
                <CopyButton value={plaintext} label="Copy key" />
              </div>
              <div className="grid gap-2">
                <Label>Connect Claude Code</Label>
                <pre className="bg-muted overflow-x-auto rounded-md px-3 py-2 text-xs whitespace-pre-wrap break-all">
                  {claudeCodeSnippet(plaintext)}
                </pre>
                <CopyButton value={claudeCodeSnippet(plaintext)} label="Copy command" />
                <p className="text-muted-foreground text-xs">
                  Once connected, your agent can register work you give it directly in chat:
                  it creates the task in Palouse and reports its steps, cost, and result here.
                </p>
                {!MCP_URL && (
                  <p className="text-muted-foreground text-xs">
                    Replace {MCP_URL_PLACEHOLDER} with your instance&apos;s MCP endpoint.
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label>Other MCP clients (HTTP)</Label>
                <pre className="bg-muted overflow-x-auto rounded-md px-3 py-2 text-xs">
                  {httpConfigSnippet(plaintext)}
                </pre>
                <CopyButton value={httpConfigSnippet(plaintext)} label="Copy config" />
                <p className="text-muted-foreground text-xs">
                  Self-hosting next to the database? You can run the server locally instead:
                  configure <code>palouse-mcp --stdio</code> with this key in{' '}
                  <code>PALOUSE_API_KEY</code>.
                </p>
                <CopyButton value={stdioConfigSnippet(plaintext)} label="Copy stdio config" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
