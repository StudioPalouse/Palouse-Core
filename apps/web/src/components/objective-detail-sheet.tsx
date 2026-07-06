'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Bot, Plus, X } from 'lucide-react';
import type { KeyResult, ObjectiveDetail, ObjectiveStatus } from '@palouse/shared';
import {
  Badge,
  Button,
  cn,
  Input,
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
} from '@palouse/ui';
import { api, ApiError } from '@/lib/api';
import {
  formatDate,
  formatKeyResultValue,
  OBJECTIVE_STATUS_LABELS,
  OBJECTIVE_STATUS_ORDER,
  OBJECTIVE_STATUS_TONE,
} from '@/lib/objective-meta';
import { Markdown } from './markdown';
import { ProgressBar } from './objective-list';

/** Rolled-up objective progress: the average of its key results' attainment. */
function rollup(keyResults: KeyResult[]): number {
  if (keyResults.length === 0) return 0;
  return Math.round(keyResults.reduce((sum, kr) => sum + kr.progress, 0) / keyResults.length);
}

export function ObjectiveDetailSheet({
  workspaceId,
  objectiveId,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  objectiveId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ObjectiveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!objectiveId) return;
    const data = await api.getObjective(workspaceId, objectiveId);
    setDetail(data);
  }, [workspaceId, objectiveId]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    void load();
  }, [load]);

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
    <Sheet open={objectiveId !== null} onOpenChange={(open) => !open && onClose()}>
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
                <span>{detail.objective.title}</span>
                {detail.objective.origin === 'agent' && (
                  <Badge variant="outline" className="gap-1">
                    <Bot className="size-3" />
                    Agent
                  </Badge>
                )}
              </SheetTitle>
              <SheetDescription>
                Created {formatDate(detail.objective.createdAt)} · Updated{' '}
                {formatDate(detail.objective.updatedAt)}
                {detail.objective.targetDate && (
                  <> · Target {formatDate(detail.objective.targetDate)}</>
                )}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-6 px-4 pb-6">
              {error && <p className="text-destructive text-sm">{error}</p>}

              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={detail.objective.status}
                  onValueChange={(v) =>
                    void run(() =>
                      api.updateObjective(workspaceId, detail.objective.id, {
                        status: v as ObjectiveStatus,
                      }),
                    )
                  }
                >
                  <SelectTrigger size="sm" variant="ghost">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OBJECTIVE_STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>
                        {OBJECTIVE_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span
                  className={cn(
                    'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                    OBJECTIVE_STATUS_TONE[detail.objective.status],
                  )}
                >
                  {OBJECTIVE_STATUS_LABELS[detail.objective.status]}
                </span>
                {detail.objective.area && (
                  <Badge variant="secondary">{detail.objective.area}</Badge>
                )}
              </div>

              {detail.keyResults.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-muted-foreground flex items-center justify-between text-xs font-medium">
                    <span>Overall progress</span>
                  </div>
                  <ProgressBar value={rollup(detail.keyResults)} />
                </div>
              )}

              {detail.objective.descriptionMd && (
                <Markdown className="text-muted-foreground">
                  {detail.objective.descriptionMd}
                </Markdown>
              )}

              <Separator />

              <KeyResultsSection
                detail={detail}
                onUpdate={(krId, currentValue) =>
                  run(() =>
                    api.updateKeyResult(workspaceId, detail.objective.id, krId, { currentValue }),
                  )
                }
                onAdd={(input) =>
                  run(() => api.addKeyResult(workspaceId, detail.objective.id, input))
                }
                onRemove={(krId) =>
                  run(() => api.removeKeyResult(workspaceId, detail.objective.id, krId))
                }
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function KeyResultsSection({
  detail,
  onUpdate,
  onAdd,
  onRemove,
}: {
  detail: ObjectiveDetail;
  onUpdate: (krId: string, currentValue: number) => Promise<void>;
  onAdd: (input: {
    name: string;
    startValue: number;
    targetValue: number;
    currentValue?: number;
    unit?: string | null;
  }) => Promise<void>;
  onRemove: (krId: string) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Key results</h3>
      {detail.keyResults.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No key results yet. Add one to make this goal measurable.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {detail.keyResults.map((kr) => (
            <KeyResultRow key={kr.id} kr={kr} onUpdate={onUpdate} onRemove={onRemove} />
          ))}
        </ul>
      )}
      <AddKeyResultForm onAdd={onAdd} />
    </div>
  );
}

function KeyResultRow({
  kr,
  onUpdate,
  onRemove,
}: {
  kr: KeyResult;
  onUpdate: (krId: string, currentValue: number) => Promise<void>;
  onRemove: (krId: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(kr.currentValue));
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = Number(value);
    if (Number.isNaN(n)) return;
    setSaving(true);
    try {
      await onUpdate(kr.id, n);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate">{kr.name}</span>
        {editing ? (
          <span className="flex items-center gap-1">
            <Input
              className="h-7 w-24"
              type="number"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
            />
            <Button size="sm" className="h-7" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => {
                setValue(String(kr.currentValue));
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground tabular-nums"
              onClick={() => setEditing(true)}
            >
              {formatKeyResultValue(kr.currentValue, kr.unit)} /{' '}
              {formatKeyResultValue(kr.targetValue, kr.unit)}
            </button>
            <button
              type="button"
              aria-label="Remove key result"
              className="text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => void onRemove(kr.id)}
            >
              <X className="size-3.5" />
            </button>
          </>
        )}
      </div>
      <ProgressBar value={kr.progress} />
    </li>
  );
}

function AddKeyResultForm({
  onAdd,
}: {
  onAdd: (input: {
    name: string;
    startValue: number;
    targetValue: number;
    currentValue?: number;
    unit?: string | null;
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [startValue, setStartValue] = useState('0');
  const [currentValue, setCurrentValue] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [unit, setUnit] = useState('');
  const [adding, setAdding] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    const target = Number(targetValue);
    if (!name.trim() || targetValue.trim() === '' || Number.isNaN(target)) return;
    const start = startValue.trim() === '' ? 0 : Number(startValue);
    setAdding(true);
    try {
      await onAdd({
        name: name.trim(),
        startValue: Number.isNaN(start) ? 0 : start,
        targetValue: target,
        currentValue: currentValue.trim() === '' ? undefined : Number(currentValue),
        unit: unit.trim() || null,
      });
      setName('');
      setStartValue('0');
      setCurrentValue('');
      setTargetValue('');
      setUnit('');
      setOpen(false);
    } finally {
      setAdding(false);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" />
        Add key result
      </Button>
    );
  }

  return (
    <form onSubmit={add} className="flex flex-col gap-2 rounded-md border p-2">
      <Input
        className="h-8"
        maxLength={300}
        placeholder="What is measured, e.g. Signups per week"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="grid grid-cols-4 gap-2">
        <Input
          className="h-8"
          type="number"
          placeholder="Start"
          value={startValue}
          onChange={(e) => setStartValue(e.target.value)}
        />
        <Input
          className="h-8"
          type="number"
          placeholder="Current"
          value={currentValue}
          onChange={(e) => setCurrentValue(e.target.value)}
        />
        <Input
          className="h-8"
          type="number"
          placeholder="Target"
          value={targetValue}
          onChange={(e) => setTargetValue(e.target.value)}
        />
        <Input
          className="h-8"
          maxLength={50}
          placeholder="Unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={adding || !name.trim() || !targetValue.trim()}>
          {adding ? 'Adding…' : 'Add'}
        </Button>
      </div>
    </form>
  );
}
