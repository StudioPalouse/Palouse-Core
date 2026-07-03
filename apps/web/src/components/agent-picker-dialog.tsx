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
  taskIds,
  open,
  onOpenChange,
  onHandedOff,
}: {
  workspaceId: string;
  /** One task from the sheet or row action, several from a bulk selection. */
  taskIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHandedOff: () => void;
}) {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [agentId, setAgentId] = useState('');
  const [reviewRequired, setReviewRequired] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const many = taskIds.length > 1;

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
    if (!agentId || taskIds.length === 0) return;
    setSubmitting(true);
    setError(null);
    const results = await Promise.allSettled(
      taskIds.map((taskId) => api.createHandoff(workspaceId, taskId, { agentId, reviewRequired })),
    );
    setSubmitting(false);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (results.length > failed.length) emitHandoffsChanged();
    if (failed.length === 0) {
      onOpenChange(false);
      onHandedOff();
      return;
    }
    const reason =
      failed[0]!.reason instanceof ApiError ? failed[0]!.reason.message : 'Request failed';
    if (failed.length === taskIds.length) {
      setError(taskIds.length === 1 ? reason : `No hand-offs went through. ${reason}`);
    } else {
      // Partial: succeeded tasks are queued; leave the dialog open so the
      // failures are seen. The task list prunes handed-off rows on its own.
      setError(
        `${failed.length} of ${taskIds.length} hand-offs didn't go through. The rest are queued.`,
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {many ? `Hand off ${taskIds.length} tasks` : 'Hand off to agent'}
          </DialogTitle>
          <DialogDescription>
            The agent picks the work up over MCP and reports back here.
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
                {submitting
                  ? 'Handing off…'
                  : many
                    ? `Hand off ${taskIds.length} tasks`
                    : 'Hand off'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
