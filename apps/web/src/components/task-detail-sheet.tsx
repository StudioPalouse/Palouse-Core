'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Task, TaskComment, TaskSource, TaskStatus } from '@palouse/shared';
import { Bot } from 'lucide-react';
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Textarea,
} from '@palouse/ui';
import { api } from '@/lib/api';
import { formatDate, PRIORITY_LABELS, STATUS_LABELS, STATUS_ORDER } from '@/lib/task-meta';
import { EntityActivity } from './entity-activity';
import { HandoffPanel } from './handoff-panel';
import { Markdown } from './markdown';

export function TaskDetailSheet({
  workspaceId,
  taskId,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  taskId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [sources, setSources] = useState<TaskSource[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    if (!taskId) return;
    const data = await api.getTask(workspaceId, taskId);
    setTask(data.task);
    setComments(data.comments);
    setSources(data.sources);
  }, [workspaceId, taskId]);

  useEffect(() => {
    setTask(null);
    setComments([]);
    void load();
  }, [load]);

  async function patch(input: Parameters<typeof api.updateTask>[2]) {
    if (!taskId) return;
    const { task: updated } = await api.updateTask(workspaceId, taskId, input);
    setTask(updated);
    onChanged();
  }

  async function postComment(e: FormEvent) {
    e.preventDefault();
    if (!taskId || !commentBody.trim()) return;
    setPosting(true);
    try {
      await api.addComment(workspaceId, taskId, commentBody.trim());
      setCommentBody('');
      await load();
    } finally {
      setPosting(false);
    }
  }

  return (
    <Sheet open={taskId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto">
        {!task ? (
          <SheetHeader>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </SheetHeader>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{task.title}</SheetTitle>
              <SheetDescription>
                Created {formatDate(task.createdAt)} · Updated {formatDate(task.updatedAt)}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-6 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={task.status}
                  onValueChange={(v) => void patch({ status: v as TaskStatus })}
                >
                  <SelectTrigger size="sm" variant="ghost">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(task.priority)}
                  onValueChange={(v) => void patch({ priority: Number(v) })}
                >
                  <SelectTrigger size="sm" variant="ghost">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {task.origin === 'agent' && (
                  <Badge variant="outline" className="gap-1">
                    <Bot className="size-3" />
                    {task.createdByAgentName ? `Created by ${task.createdByAgentName}` : 'Agent created'}
                  </Badge>
                )}
                {sources.length === 0 ? (
                  <Badge variant="outline">Native</Badge>
                ) : (
                  sources.map((s) => (
                    <Badge key={s.id} variant="secondary">
                      {s.externalSystem}
                    </Badge>
                  ))
                )}
              </div>

              {task.descriptionMd && (
                <Markdown className="text-muted-foreground">{task.descriptionMd}</Markdown>
              )}

              <Separator />

              <HandoffPanel workspaceId={workspaceId} taskId={task.id} />

              <Separator />

              <div className="flex flex-col gap-4">
                <h3 className="text-sm font-medium">Comments</h3>
                {comments.length === 0 && (
                  <p className="text-muted-foreground text-sm">No comments yet.</p>
                )}
                {comments.map((c) => (
                  <div key={c.id} className="rounded-md border p-3">
                    <Markdown>{c.bodyMd}</Markdown>
                    <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
                      {c.authorAgentId && <Bot className="size-3" />}
                      {c.authorName && <span>{c.authorName}</span>}
                      {c.authorName && <span aria-hidden>·</span>}
                      {formatDate(c.createdAt)}
                    </p>
                  </div>
                ))}
                <form onSubmit={postComment} className="flex flex-col gap-2">
                  <Textarea
                    rows={3}
                    placeholder="Add a comment…"
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="self-end"
                    disabled={posting || !commentBody.trim()}
                  >
                    {posting ? 'Posting…' : 'Comment'}
                  </Button>
                </form>
              </div>

              <Separator />

              <EntityActivity workspaceId={workspaceId} targetType="task" targetId={task.id} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
