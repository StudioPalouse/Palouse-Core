'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Agent } from '@palouse/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@palouse/ui';
import { api, ApiError } from '@/lib/api';
import { emitHandoffsChanged } from '@/lib/handoff-meta';

export function AgentPickerDialog({
  workspaceId,
  taskId,
  open,
  onOpenChange,
  onHandedOff,
}: {
  workspaceId: string;
  taskId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHandedOff: () => void;
}) {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [agentId, setAgentId] = useState('');
  const [reviewRequired, setReviewRequired] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api.listAgents(workspaceId).then(({ agents }) => {
      setAgents(agents);
      if (agents.length > 0) setAgentId((id) => id || agents[0]!.id);
    });
  }, [open, workspaceId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!agentId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createHandoff(workspaceId, taskId, { agentId, reviewRequired });
      emitHandoffsChanged();
      onOpenChange(false);
      onHandedOff();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to hand off task');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hand off to agent</DialogTitle>
          <DialogDescription>
            The agent picks the task up over MCP and reports back here.
          </DialogDescription>
        </DialogHeader>
        {agents !== null && agents.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No agents in this workspace yet. Head to{' '}
            <Link href="/settings/agents" className="text-foreground underline underline-offset-2">
              Agents
            </Link>{' '}
            to create one and mint a key, then come back.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label>Agent</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick an agent" />
                </SelectTrigger>
                <SelectContent>
                  {(agents ?? []).map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-foreground size-4"
                checked={reviewRequired}
                onChange={(e) => setReviewRequired(e.target.checked)}
              />
              Review the agent&apos;s work before it counts as done
            </label>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={submitting || !agentId}>
                {submitting ? 'Handing off…' : 'Hand off'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
