'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, X } from 'lucide-react';
import type { DecisionListItem, ProjectDetail, TaskListItem } from '@palouse/shared';
import {
  Badge,
  Button,
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
  Switch,
  Textarea,
} from '@palouse/ui';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/project-meta';

function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

export function ProjectItemDetailSheet({
  workspaceId,
  projectId,
  detail,
  itemId,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  projectId: string;
  detail: ProjectDetail;
  itemId: string | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const item = detail.items.find((i) => i.id === itemId) ?? null;
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [decisions, setDecisions] = useState<DecisionListItem[]>([]);

  // Load workspace tasks and decisions once for the link pickers.
  useEffect(() => {
    if (!itemId) return;
    api.listTasks(workspaceId, { limit: 200 }).then(({ tasks }) => setTasks(tasks));
    api.listDecisions(workspaceId, { limit: 200 }).then(({ decisions }) => setDecisions(decisions));
  }, [workspaceId, itemId]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
        await onChanged();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Something went wrong');
      }
    },
    [onChanged],
  );

  return (
    <Sheet open={itemId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        {!item ? (
          <SheetHeader>
            <SheetTitle>Card</SheetTitle>
          </SheetHeader>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span>{item.title}</span>
                {item.origin === 'agent' && (
                  <Badge variant="outline" className="gap-1">
                    <Bot className="size-3" />
                    Agent
                  </Badge>
                )}
              </SheetTitle>
              <SheetDescription>
                Created {formatDate(item.createdAt)} · Updated {formatDate(item.updatedAt)}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-5 px-4 pb-6">
              {error && <p className="text-destructive text-sm">{error}</p>}

              <TitleField
                key={`title-${item.id}`}
                value={item.title}
                onSave={(title) =>
                  run(() => api.updateProjectItem(workspaceId, projectId, item.id, { title }))
                }
              />

              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="item-done"
                    checked={item.completedAt !== null}
                    onCheckedChange={(completed) =>
                      run(() =>
                        api.updateProjectItem(workspaceId, projectId, item.id, { completed }),
                      )
                    }
                  />
                  <Label htmlFor="item-done">Done</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-muted-foreground text-xs">Column</Label>
                  <Select
                    value={item.columnId}
                    onValueChange={(columnId) =>
                      run(() =>
                        api.updateProjectItem(workspaceId, projectId, item.id, { columnId }),
                      )
                    }
                  >
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {detail.columns.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="item-start" className="text-muted-foreground text-xs">
                    Start
                  </Label>
                  <Input
                    id="item-start"
                    type="date"
                    defaultValue={toDateInput(item.startDate)}
                    onChange={(e) =>
                      run(() =>
                        api.updateProjectItem(workspaceId, projectId, item.id, {
                          startDate: e.target.value ? new Date(e.target.value).toISOString() : null,
                        }),
                      )
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="item-end" className="text-muted-foreground text-xs">
                    Due
                  </Label>
                  <Input
                    id="item-end"
                    type="date"
                    defaultValue={toDateInput(item.endDate)}
                    onChange={(e) =>
                      run(() =>
                        api.updateProjectItem(workspaceId, projectId, item.id, {
                          endDate: e.target.value ? new Date(e.target.value).toISOString() : null,
                        }),
                      )
                    }
                  />
                </div>
              </div>

              <DescriptionField
                key={`desc-${item.id}`}
                value={item.descriptionMd ?? ''}
                onSave={(descriptionMd) =>
                  run(() =>
                    api.updateProjectItem(workspaceId, projectId, item.id, {
                      descriptionMd: descriptionMd || null,
                    }),
                  )
                }
              />

              <Separator />

              <LinkSection
                title="Tasks"
                empty="No tasks linked."
                placeholder="Link a task…"
                links={item.linkedTasks.map((t) => ({
                  id: t.taskId,
                  label: t.title,
                  removeId: t.taskId,
                }))}
                options={tasks
                  .filter((t) => !item.linkedTasks.some((l) => l.taskId === t.id))
                  .map((t) => ({ id: t.id, label: t.title }))}
                onAdd={(taskId) =>
                  run(() => api.linkProjectItemTask(workspaceId, projectId, item.id, taskId))
                }
                onRemove={(taskId) =>
                  run(() => api.unlinkProjectItemTask(workspaceId, projectId, item.id, taskId))
                }
              />

              <LinkSection
                title="Decisions"
                empty="No decisions linked."
                placeholder="Link a decision…"
                links={item.linkedDecisions.map((d) => ({
                  id: d.decisionId,
                  label: d.title,
                  removeId: d.decisionId,
                }))}
                options={decisions
                  .filter((d) => !item.linkedDecisions.some((l) => l.decisionId === d.id))
                  .map((d) => ({ id: d.id, label: d.title }))}
                onAdd={(decisionId) =>
                  run(() => api.linkProjectItemDecision(workspaceId, projectId, item.id, decisionId))
                }
                onRemove={(decisionId) =>
                  run(() =>
                    api.unlinkProjectItemDecision(workspaceId, projectId, item.id, decisionId),
                  )
                }
              />

              <DependencySection
                detail={detail}
                itemId={item.id}
                predecessorIds={item.predecessorItemIds}
                successorIds={item.successorItemIds}
                onAdd={(predecessorItemId) =>
                  run(() =>
                    api.addProjectDependency(workspaceId, projectId, {
                      predecessorItemId,
                      successorItemId: item.id,
                    }),
                  )
                }
                onRemove={(predecessorItemId) => {
                  const dep = detail.dependencies.find(
                    (d) => d.predecessorItemId === predecessorItemId && d.successorItemId === item.id,
                  );
                  if (dep)
                    return run(() =>
                      api.removeProjectDependency(workspaceId, projectId, dep.id),
                    );
                }}
              />

              <Separator />

              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive self-start"
                onClick={() =>
                  run(() => api.removeProjectItem(workspaceId, projectId, item.id)).then(onClose)
                }
              >
                Delete card
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TitleField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="item-title" className="text-muted-foreground text-xs">
        Title
      </Label>
      <Input
        id="item-title"
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() && text !== value && onSave(text.trim())}
      />
    </div>
  );
}

function DescriptionField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="item-desc" className="text-muted-foreground text-xs">
        Description
      </Label>
      <Textarea
        id="item-desc"
        rows={3}
        placeholder="Detail for this card (markdown)."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onSave(text)}
      />
    </div>
  );
}

function LinkSection({
  title,
  empty,
  placeholder,
  links,
  options,
  onAdd,
  onRemove,
}: {
  title: string;
  empty: string;
  placeholder: string;
  links: { id: string; label: string; removeId: string }[];
  options: { id: string; label: string }[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [pick, setPick] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {links.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {links.map((l) => (
            <Badge key={l.id} variant="outline" className="max-w-full gap-1">
              <span className="truncate">{l.label}</span>
              <button
                type="button"
                aria-label="Remove link"
                className="text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => onRemove(l.removeId)}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {options.length > 0 && (
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
            onClick={() => {
              onAdd(pick);
              setPick('');
            }}
          >
            Link
          </Button>
        </div>
      )}
    </div>
  );
}

function DependencySection({
  detail,
  itemId,
  predecessorIds,
  successorIds,
  onAdd,
  onRemove,
}: {
  detail: ProjectDetail;
  itemId: string;
  predecessorIds: string[];
  successorIds: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [pick, setPick] = useState('');
  const titleById = new Map(detail.items.map((i) => [i.id, i.title]));
  // A card cannot depend on itself, on a card it already waits on, or on one that
  // already waits on it (which would be an obvious cycle).
  const options = detail.items.filter(
    (i) => i.id !== itemId && !predecessorIds.includes(i.id) && !successorIds.includes(i.id),
  );

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Dependencies</h3>
      <p className="text-muted-foreground text-xs">Cards that must finish before this one.</p>
      {predecessorIds.length === 0 ? (
        <p className="text-muted-foreground text-sm">Waiting on nothing.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {predecessorIds.map((pid) => (
            <Badge key={pid} variant="outline" className="max-w-full gap-1">
              <span className="truncate">{titleById.get(pid) ?? 'Card'}</span>
              <button
                type="button"
                aria-label="Remove dependency"
                className="text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => onRemove(pid)}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {successorIds.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Blocks: {successorIds.map((sid) => titleById.get(sid) ?? 'Card').join(', ')}
        </p>
      )}
      {options.length > 0 && (
        <div className="flex items-center gap-2">
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger size="sm" className="flex-1">
              <SelectValue placeholder="Add a card this waits on…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!pick}
            onClick={() => {
              onAdd(pick);
              setPick('');
            }}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
