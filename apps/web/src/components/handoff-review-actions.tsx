'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Textarea,
} from '@palouse/ui';
import { api, ApiError } from '@/lib/api';
import { emitHandoffsChanged } from '@/lib/handoff-meta';

/**
 * The one approve / send-back block shared by the task sheet, the review
 * queue, and the activity report, so copy and behavior can't drift.
 */
export function HandoffReviewActions({
  workspaceId,
  handoffId,
  onReviewed,
}: {
  workspaceId: string;
  handoffId: string;
  onReviewed: () => void;
}) {
  const [note, setNote] = useState('');
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review(decision: 'approved' | 'rejected', rejectAction?: 'retry' | 'fail') {
    setActing(true);
    setError(null);
    try {
      await api.reviewHandoff(workspaceId, handoffId, {
        decision,
        note: note.trim() || undefined,
        ...(decision === 'rejected' ? { rejectAction } : {}),
      });
      setNote('');
      emitHandoffsChanged();
      onReviewed();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : decision === 'approved'
            ? "Couldn't record the approval. Try again."
            : "Couldn't record the review. Try again.",
      );
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        rows={2}
        placeholder="Optional note for the record…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex justify-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={acting}>
              Send back
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void review('rejected', 'retry')}>
              <div className="flex flex-col">
                <span>For another attempt</span>
                <span className="text-muted-foreground text-xs">
                  The agent tries again with your note.
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void review('rejected', 'fail')}>
              <div className="flex flex-col">
                <span>Reject and close</span>
                <span className="text-muted-foreground text-xs">
                  Marks the agent task as failed, with no retry.
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" disabled={acting} onClick={() => void review('approved')}>
          Approve
        </Button>
      </div>
    </div>
  );
}
