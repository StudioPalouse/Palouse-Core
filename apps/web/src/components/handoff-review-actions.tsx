'use client';

import { useState } from 'react';
import { Button, Textarea } from '@palouse/ui';
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

  async function review(decision: 'approved' | 'rejected') {
    setActing(true);
    setError(null);
    try {
      await api.reviewHandoff(workspaceId, handoffId, {
        decision,
        note: note.trim() || undefined,
        ...(decision === 'rejected' ? { rejectAction: 'retry' as const } : {}),
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
            : "Couldn't send this back. Try again.",
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
        <Button
          variant="outline"
          size="sm"
          disabled={acting}
          onClick={() => void review('rejected')}
        >
          Send back
        </Button>
        <Button size="sm" disabled={acting} onClick={() => void review('approved')}>
          Approve
        </Button>
      </div>
    </div>
  );
}
