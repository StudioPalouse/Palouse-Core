'use client';

import { useState } from 'react';
import type { AgentKeyScope } from '@palouse/shared';
import { ALL_AGENT_KEY_SCOPES, WILDCARD_SCOPE } from '@palouse/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@palouse/ui';
import { AgentKeyReveal } from '@/components/agent-key-reveal';
import { AgentScopePicker } from '@/components/agent-scope-picker';
import { api, ApiError } from '@/lib/api';

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
  // Full access mints a wildcard ('*') key that stays valid as new capabilities
  // ship. Turn it off to pick a fixed granular subset instead.
  const [fullAccess, setFullAccess] = useState(true);
  const [scopes, setScopes] = useState<AgentKeyScope[]>([...ALL_AGENT_KEY_SCOPES]);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setFullAccess(true);
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

  const canCreate = fullAccess || scopes.length > 0;

  async function create() {
    if (!canCreate) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: AgentKeyScope[] = fullAccess ? [WILDCARD_SCOPE] : scopes;
      const { plaintext } = await api.createAgentKey(workspaceId, agentId, { scopes: payload });
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
            <AgentScopePicker
              fullAccess={fullAccess}
              onFullAccessChange={setFullAccess}
              scopes={scopes}
              onToggleScope={toggle}
            />
            {error && <p className="text-destructive text-sm">{error}</p>}
            <DialogFooter>
              <Button onClick={() => void create()} disabled={submitting || !canCreate}>
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
            <AgentKeyReveal plaintext={plaintext} />
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
