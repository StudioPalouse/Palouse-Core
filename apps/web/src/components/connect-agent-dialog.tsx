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
import { AgentKeyReveal } from '@/components/agent-key-reveal';
import { AgentScopePicker } from '@/components/agent-scope-picker';
import { api, ApiError } from '@/lib/api';
import { AGENT_KIND_LABELS } from '@/lib/agent-meta';

/**
 * Single connect flow: register the agent and mint its first key in one step,
 * then show the key with ready-to-paste MCP setup snippets.
 */
export function ConnectAgentDialog({
  workspaceId,
  onConnected,
  onDone,
}: {
  workspaceId: string;
  /** Fired as soon as the agent exists, so lists can refresh behind the dialog. */
  onConnected?: (agent: Agent) => void;
  /** Fired when the user closes the reveal step. */
  onDone?: (agent: Agent) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AgentKind>('mcp_generic');
  const [fullAccess, setFullAccess] = useState(true);
  const [scopes, setScopes] = useState<AgentKeyScope[]>([...ALL_AGENT_KEY_SCOPES]);
  const [created, setCreated] = useState<{ agent: Agent; plaintext: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
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
        {created === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Connect an agent</DialogTitle>
              <DialogDescription>
                Name the agent, choose what it can do, and you get a key plus setup snippets to
                paste into your MCP client.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
                  {submitting ? 'Connecting…' : 'Connect'}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
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
        )}
      </DialogContent>
    </Dialog>
  );
}
