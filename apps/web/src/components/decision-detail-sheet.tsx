'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Bot, ExternalLink, X } from 'lucide-react';
import type {
  DecisionDetail,
  DecisionStatus,
  StakeholderAssignment,
  TaskListItem,
  WorkspaceMember,
} from '@palouse/shared';
import {
  Badge,
  Button,
  cn,
  Input,
  Label,
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
import { api, ApiError } from '@/lib/api';
import {
  DECISION_STATUS_LABELS,
  DECISION_STATUS_ORDER,
  DECISION_STATUS_TONE,
  ENTITY_TYPE_LABELS,
  formatDate,
  RACI_LABELS,
  RACI_ORDER,
} from '@/lib/decision-meta';
import { Markdown } from './markdown';
import { RaciPicker } from './raci-picker';

export function DecisionDetailSheet({
  workspaceId,
  decisionId,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  decisionId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<DecisionDetail | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!decisionId) return;
    const data = await api.getDecision(workspaceId, decisionId);
    setDetail(data);
  }, [workspaceId, decisionId]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    void load();
  }, [load]);

  // Members (for RACI) and tasks (to link and to label task relations) are
  // loaded once per open; both are workspace-scoped and change rarely.
  useEffect(() => {
    if (!decisionId) return;
    api
      .listMembers(workspaceId)
      .then(({ members }) => setMembers(members))
      .catch(() => {});
    api
      .listTasks(workspaceId, { limit: 200 })
      .then(({ tasks }) => setTasks(tasks))
      .catch(() => {});
  }, [workspaceId, decisionId]);

  const taskTitles = useMemo(() => new Map(tasks.map((t) => [t.id, t.title])), [tasks]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  return (
    <Sheet open={decisionId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        {!detail ? (
          <SheetHeader>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </SheetHeader>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span>{detail.decision.title}</span>
                {detail.decision.origin === 'agent' && (
                  <Badge variant="outline" className="gap-1">
                    <Bot className="size-3" />
                    Agent
                  </Badge>
                )}
              </SheetTitle>
              <SheetDescription>
                Created {formatDate(detail.decision.createdAt)} · Updated{' '}
                {formatDate(detail.decision.updatedAt)}
                {detail.decision.decidedAt && (
                  <> · Decided {formatDate(detail.decision.decidedAt)}</>
                )}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-6 px-4 pb-6">
              {error && <p className="text-destructive text-sm">{error}</p>}

              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={detail.decision.status}
                  onValueChange={(v) =>
                    void run(() =>
                      api.updateDecision(workspaceId, detail.decision.id, {
                        status: v as DecisionStatus,
                      }),
                    )
                  }
                >
                  <SelectTrigger size="sm" variant="ghost">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DECISION_STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>
                        {DECISION_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span
                  className={cn(
                    'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                    DECISION_STATUS_TONE[detail.decision.status],
                  )}
                >
                  {DECISION_STATUS_LABELS[detail.decision.status]}
                </span>
                {detail.decision.area && <Badge variant="secondary">{detail.decision.area}</Badge>}
              </div>

              {detail.decision.descriptionMd && (
                <Markdown className="text-muted-foreground">
                  {detail.decision.descriptionMd}
                </Markdown>
              )}

              <Separator />

              <RaciSection
                detail={detail}
                members={members}
                onSave={(stakeholders) =>
                  run(() =>
                    api.setDecisionStakeholders(workspaceId, detail.decision.id, stakeholders),
                  )
                }
              />

              <Separator />

              <RelationsSection
                detail={detail}
                tasks={tasks}
                taskTitles={taskTitles}
                onAdd={(entityId) =>
                  run(() =>
                    api.addDecisionRelation(workspaceId, detail.decision.id, {
                      entityType: 'task',
                      entityId,
                    }),
                  )
                }
                onRemove={(relationId) =>
                  run(() => api.removeDecisionRelation(workspaceId, detail.decision.id, relationId))
                }
              />

              <Separator />

              <ResourcesSection
                detail={detail}
                onAdd={(input) =>
                  run(() => api.addDecisionResource(workspaceId, detail.decision.id, input))
                }
                onRemove={(resourceId) =>
                  run(() => api.removeDecisionResource(workspaceId, detail.decision.id, resourceId))
                }
              />

              <Separator />

              <CommentsSection
                detail={detail}
                onPost={(body) =>
                  run(() => api.addDecisionComment(workspaceId, detail.decision.id, body))
                }
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RaciSection({
  detail,
  members,
  onSave,
}: {
  detail: DecisionDetail;
  members: WorkspaceMember[];
  onSave: (stakeholders: StakeholderAssignment[]) => Promise<void>;
}) {
  const current: StakeholderAssignment[] = detail.stakeholders.map((s) => ({
    userId: s.userId,
    role: s.role,
  }));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StakeholderAssignment[]>(current);
  const [saving, setSaving] = useState(false);

  const nameByUser = new Map(members.map((m) => [m.userId, m.name || m.email]));
  const accountableCount = draft.filter((s) => s.role === 'accountable').length;

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">RACI</h3>
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(current);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-3">
          <RaciPicker members={members} value={draft} onChange={setDraft} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={saving || accountableCount > 1} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save RACI'}
            </Button>
          </div>
        </div>
      ) : detail.stakeholders.length === 0 ? (
        <p className="text-muted-foreground text-sm">No stakeholders assigned yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {RACI_ORDER.map((role) => {
            const people = detail.stakeholders.filter((s) => s.role === role);
            if (people.length === 0) return null;
            return (
              <div key={role} className="flex items-baseline gap-2 text-sm">
                <span className="text-muted-foreground w-24 shrink-0">{RACI_LABELS[role]}</span>
                <span className="flex flex-wrap gap-1">
                  {people.map((s) => (
                    <Badge key={s.id} variant="secondary">
                      {nameByUser.get(s.userId) ?? 'Unknown'}
                    </Badge>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RelationsSection({
  detail,
  tasks,
  taskTitles,
  onAdd,
  onRemove,
}: {
  detail: DecisionDetail;
  tasks: TaskListItem[];
  taskTitles: Map<string, string>;
  onAdd: (entityId: string) => Promise<void>;
  onRemove: (relationId: string) => Promise<void>;
}) {
  const linkedTaskIds = new Set(
    detail.relations.filter((r) => r.entityType === 'task').map((r) => r.entityId),
  );
  const available = tasks.filter((t) => !linkedTaskIds.has(t.id));
  const [pick, setPick] = useState('');

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Related</h3>
      {detail.relations.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing linked yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {detail.relations.map((r) => (
            <Badge key={r.id} variant="outline" className="gap-1">
              <span className="text-muted-foreground">{ENTITY_TYPE_LABELS[r.entityType]}:</span>
              <span>
                {r.entityType === 'task' ? (taskTitles.get(r.entityId) ?? 'Task') : r.entityId}
              </span>
              <button
                type="button"
                aria-label="Remove link"
                className="hover:text-foreground text-muted-foreground"
                onClick={() => void onRemove(r.id)}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger size="sm" className="flex-1">
              <SelectValue placeholder="Link a task…" />
            </SelectTrigger>
            <SelectContent>
              {available.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!pick}
            onClick={() => void onAdd(pick).then(() => setPick(''))}
          >
            Link
          </Button>
        </div>
      )}
    </div>
  );
}

function ResourcesSection({
  detail,
  onAdd,
  onRemove,
}: {
  detail: DecisionDetail;
  onAdd: (input: {
    label: string;
    url: string;
    kind: 'link' | 'document' | 'other';
  }) => Promise<void>;
  onRemove: (resourceId: string) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!label.trim() || !url.trim()) return;
    setAdding(true);
    try {
      await onAdd({ label: label.trim(), url: url.trim(), kind: 'link' });
      setLabel('');
      setUrl('');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Supporting resources</h3>
      {detail.resources.length === 0 ? (
        <p className="text-muted-foreground text-sm">No resources attached.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {detail.resources.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 underline underline-offset-2"
              >
                <ExternalLink className="size-3 shrink-0" />
                {r.label}
              </a>
              <button
                type="button"
                aria-label="Remove resource"
                className="hover:text-foreground text-muted-foreground ml-auto"
                onClick={() => void onRemove(r.id)}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-col gap-2">
        <Input
          placeholder="Label"
          maxLength={300}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <div className="flex gap-2">
          <Input
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={adding || !label.trim() || !url.trim()}
          >
            Add
          </Button>
        </div>
      </form>
    </div>
  );
}

function CommentsSection({
  detail,
  onPost,
}: {
  detail: DecisionDetail;
  onPost: (body: string) => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);

  async function post(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setPosting(true);
    try {
      await onPost(body.trim());
      setBody('');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-medium">Discussion</h3>
      {detail.comments.length === 0 && (
        <p className="text-muted-foreground text-sm">No comments yet.</p>
      )}
      {detail.comments.map((c) => (
        <div key={c.id} className="rounded-md border p-3">
          <Markdown>{c.bodyMd}</Markdown>
          <p className="text-muted-foreground mt-2 text-xs">
            {c.authorUserId ? '' : 'Agent · '}
            {formatDate(c.createdAt)}
          </p>
        </div>
      ))}
      <form onSubmit={post} className="flex flex-col gap-2">
        <Textarea
          rows={3}
          placeholder="Add to the discussion…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button type="submit" size="sm" className="self-end" disabled={posting || !body.trim()}>
          {posting ? 'Posting…' : 'Comment'}
        </Button>
      </form>
    </div>
  );
}
