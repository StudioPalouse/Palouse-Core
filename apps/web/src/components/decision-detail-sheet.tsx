'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Bot, ExternalLink, X } from 'lucide-react';
import type {
  AddRelationInput,
  DecisionDetail,
  DecisionEntityType,
  DecisionStatus,
  ObjectiveListItem,
  ProjectListItem,
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
  EMPTY,
  ENTITY_TYPE_LABELS,
  formatDate,
  RACI_LABELS,
  RACI_ORDER,
} from '@/lib/decision-meta';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { EntityActivity } from './entity-activity';
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
  const { capabilities } = useActiveWorkspace();
  // Unknown (null) capabilities read as enabled, matching the dashboard/nav
  // fail-open convention, so pickers do not flash off before caps load.
  const showTasks = capabilities?.tasks ?? true;
  const showObjectives = capabilities?.objectives ?? true;
  const showProjects = capabilities?.projects ?? true;

  const [detail, setDetail] = useState<DecisionDetail | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [objectives, setObjectives] = useState<ObjectiveListItem[]>([]);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
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

  // Members (for RACI) plus the entities a relation can point at (tasks,
  // objectives) are loaded once per open; all are workspace-scoped and change
  // rarely. Each entity list is fetched only when its capability is enabled.
  useEffect(() => {
    if (!decisionId) return;
    api
      .listMembers(workspaceId)
      .then(({ members }) => setMembers(members))
      .catch(() => {});
    if (showTasks) {
      api
        .listTasks(workspaceId, { limit: 200 })
        .then(({ tasks }) => setTasks(tasks))
        .catch(() => {});
    } else {
      setTasks([]);
    }
    if (showObjectives) {
      api
        .listObjectives(workspaceId, { limit: 200 })
        .then(({ objectives }) => setObjectives(objectives))
        .catch(() => {});
    } else {
      setObjectives([]);
    }
    if (showProjects) {
      api
        .listProjects(workspaceId, { limit: 200 })
        .then(({ projects }) => setProjects(projects))
        .catch(() => {});
    } else {
      setProjects([]);
    }
  }, [workspaceId, decisionId, showTasks, showObjectives, showProjects]);

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
                workspaceId={workspaceId}
                tasks={tasks}
                objectives={objectives}
                projects={projects}
                showTasks={showTasks}
                showObjectives={showObjectives}
                showProjects={showProjects}
                onAdd={(input) =>
                  run(() => api.addDecisionRelation(workspaceId, detail.decision.id, input))
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

              <Separator />

              <EntityActivity
                workspaceId={workspaceId}
                targetType="decision"
                targetId={detail.decision.id}
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
  workspaceId,
  tasks,
  objectives,
  projects,
  showTasks,
  showObjectives,
  showProjects,
  onAdd,
  onRemove,
}: {
  detail: DecisionDetail;
  workspaceId: string;
  tasks: TaskListItem[];
  objectives: ObjectiveListItem[];
  projects: ProjectListItem[];
  showTasks: boolean;
  showObjectives: boolean;
  showProjects: boolean;
  onAdd: (input: AddRelationInput) => Promise<void>;
  onRemove: (relationId: string) => Promise<void>;
}) {
  // Already-linked ids per type, so pickers do not offer duplicates (the unique
  // index would reject them anyway).
  const linkedIds = (type: DecisionEntityType) =>
    new Set(detail.relations.filter((r) => r.entityType === type).map((r) => r.entityId));
  const linkedTaskIds = linkedIds('task');
  const linkedGoalIds = linkedIds('goal');
  const linkedProjectIds = linkedIds('project');
  const availableTasks = tasks.filter((t) => !linkedTaskIds.has(t.id));
  const availableObjectives = objectives.filter((o) => !linkedGoalIds.has(o.id));
  const availableProjects = projects.filter((p) => !linkedProjectIds.has(p.id));

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
              {/* label is server-hydrated for task/goal/key_result/project; fall back
                  to the placeholder (deleted or not-yet-resolved) rather than a raw id. */}
              <span>{r.label ?? EMPTY}</span>
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

      {showTasks && availableTasks.length > 0 && (
        <RelationPicker
          placeholder="Link a task…"
          options={availableTasks.map((t) => ({ id: t.id, label: t.title }))}
          onLink={(entityId) => onAdd({ entityType: 'task', entityId })}
        />
      )}

      {showObjectives && availableObjectives.length > 0 && (
        <RelationPicker
          placeholder="Link a goal…"
          options={availableObjectives.map((o) => ({ id: o.id, label: o.title }))}
          onLink={(entityId) => onAdd({ entityType: 'goal', entityId })}
        />
      )}

      {showProjects && availableProjects.length > 0 && (
        <RelationPicker
          placeholder="Link a project…"
          options={availableProjects.map((p) => ({ id: p.id, label: p.name }))}
          onLink={(entityId) => onAdd({ entityType: 'project', entityId })}
        />
      )}

      {showObjectives && objectives.length > 0 && (
        <KeyResultPicker
          workspaceId={workspaceId}
          objectives={objectives}
          linkedKeyResultIds={linkedIds('key_result')}
          onLink={(entityId) => onAdd({ entityType: 'key_result', entityId })}
        />
      )}
    </div>
  );
}

/** A single "pick one, then Link" row shared by the task and objective pickers. */
function RelationPicker({
  placeholder,
  options,
  onLink,
}: {
  placeholder: string;
  options: { id: string; label: string }[];
  onLink: (id: string) => Promise<void>;
}) {
  const [pick, setPick] = useState('');
  return (
    <div className="flex items-center gap-2">
      <Select value={pick} onValueChange={setPick}>
        <SelectTrigger size="sm" className="flex-1">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="secondary"
        disabled={!pick}
        onClick={() => void onLink(pick).then(() => setPick(''))}
      >
        Link
      </Button>
    </div>
  );
}

/**
 * Two-step key-result picker: choose an objective, then one of its key results.
 * The KRs load on demand from the objective detail so we never bulk-fetch every
 * objective's key results just to populate a rarely-used picker.
 */
function KeyResultPicker({
  workspaceId,
  objectives,
  linkedKeyResultIds,
  onLink,
}: {
  workspaceId: string;
  objectives: ObjectiveListItem[];
  linkedKeyResultIds: Set<string>;
  onLink: (id: string) => Promise<void>;
}) {
  const [objectiveId, setObjectiveId] = useState('');
  const [krs, setKrs] = useState<{ id: string; name: string }[]>([]);
  const [krId, setKrId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!objectiveId) {
      setKrs([]);
      setKrId('');
      return;
    }
    let active = true;
    setLoading(true);
    api
      .getObjective(workspaceId, objectiveId)
      .then((detail) => {
        if (!active) return;
        setKrs(detail.keyResults.map((kr) => ({ id: kr.id, name: kr.name })));
      })
      .catch(() => active && setKrs([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [workspaceId, objectiveId]);

  const availableKrs = krs.filter((kr) => !linkedKeyResultIds.has(kr.id));

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={objectiveId}
        onValueChange={(v) => {
          setObjectiveId(v);
          setKrId('');
        }}
      >
        <SelectTrigger size="sm" className="flex-1">
          <SelectValue placeholder="Link a key result: pick a goal…" />
        </SelectTrigger>
        <SelectContent>
          {objectives.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {objectiveId && (
        <div className="flex items-center gap-2">
          <Select
            value={krId}
            onValueChange={setKrId}
            disabled={loading || availableKrs.length === 0}
          >
            <SelectTrigger size="sm" className="flex-1">
              <SelectValue
                placeholder={
                  loading
                    ? 'Loading key results…'
                    : availableKrs.length === 0
                      ? 'No key results to link'
                      : 'Pick a key result…'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {availableKrs.map((kr) => (
                <SelectItem key={kr.id} value={kr.id}>
                  {kr.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!krId}
            onClick={() =>
              void onLink(krId).then(() => {
                setKrId('');
                setObjectiveId('');
              })
            }
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
          <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
            {c.authorAgentId && <Bot className="size-3" />}
            {c.authorName && <span>{c.authorName}</span>}
            {c.authorName && <span aria-hidden>·</span>}
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
