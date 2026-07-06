'use client';

import { useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import type { CreateKeyResultInput } from '@palouse/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Textarea,
} from '@palouse/ui';
import { api, ApiError } from '@/lib/api';

type KeyResultDraft = {
  name: string;
  startValue: string;
  targetValue: string;
  currentValue: string;
  unit: string;
};

const emptyKeyResult = (): KeyResultDraft => ({
  name: '',
  startValue: '0',
  targetValue: '',
  currentValue: '',
  unit: '',
});

export function NewObjectiveDialog({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [area, setArea] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [keyResults, setKeyResults] = useState<KeyResultDraft[]>([emptyKeyResult()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setTitle('');
    setArea('');
    setDescription('');
    setTargetDate('');
    setKeyResults([emptyKeyResult()]);
  }

  function updateKr(i: number, patch: Partial<KeyResultDraft>) {
    setKeyResults((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    // Only rows with a name and a numeric target become key results.
    const krs: CreateKeyResultInput[] = [];
    for (const r of keyResults) {
      if (!r.name.trim()) continue;
      const target = Number(r.targetValue);
      if (r.targetValue.trim() === '' || Number.isNaN(target)) {
        setError('Each key result needs a numeric target value.');
        setSubmitting(false);
        return;
      }
      const start = r.startValue.trim() === '' ? 0 : Number(r.startValue);
      krs.push({
        name: r.name.trim(),
        startValue: Number.isNaN(start) ? 0 : start,
        targetValue: target,
        currentValue: r.currentValue.trim() === '' ? undefined : Number(r.currentValue),
        unit: r.unit.trim() || null,
      });
    }

    try {
      await api.createObjective(workspaceId, {
        title,
        area: area.trim() || null,
        descriptionMd: description || null,
        targetDate: targetDate ? new Date(targetDate).toISOString() : null,
        keyResults: krs.length > 0 ? krs : undefined,
      });
      reset();
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create objective');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New objective</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New objective</DialogTitle>
          <DialogDescription>
            Set a goal your team is working toward. Add measurable key results now, or come back and
            add them later.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="objective-title">Title</Label>
            <Input
              id="objective-title"
              required
              maxLength={500}
              placeholder="What are you trying to achieve?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="objective-area">Area</Label>
              <Input
                id="objective-area"
                maxLength={200}
                placeholder="e.g. Growth"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="objective-target-date">Target date</Label>
              <Input
                id="objective-target-date"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="objective-description">Context</Label>
            <Textarea
              id="objective-description"
              rows={3}
              placeholder="Why this goal matters and how success is judged (markdown)."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Key results</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setKeyResults((rows) => [...rows, emptyKeyResult()])}
              >
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>
            {keyResults.map((kr, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8"
                    maxLength={300}
                    placeholder="What is measured, e.g. Signups per week"
                    value={kr.name}
                    onChange={(e) => updateKr(i, { name: e.target.value })}
                  />
                  {keyResults.length > 1 && (
                    <button
                      type="button"
                      aria-label="Remove key result"
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      onClick={() => setKeyResults((rows) => rows.filter((_, idx) => idx !== i))}
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <Input
                    className="h-8"
                    type="number"
                    placeholder="Start"
                    value={kr.startValue}
                    onChange={(e) => updateKr(i, { startValue: e.target.value })}
                  />
                  <Input
                    className="h-8"
                    type="number"
                    placeholder="Current"
                    value={kr.currentValue}
                    onChange={(e) => updateKr(i, { currentValue: e.target.value })}
                  />
                  <Input
                    className="h-8"
                    type="number"
                    placeholder="Target"
                    value={kr.targetValue}
                    onChange={(e) => updateKr(i, { targetValue: e.target.value })}
                  />
                  <Input
                    className="h-8"
                    maxLength={50}
                    placeholder="Unit"
                    value={kr.unit}
                    onChange={(e) => updateKr(i, { unit: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create objective'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
