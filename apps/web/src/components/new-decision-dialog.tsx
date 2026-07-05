'use client';

import { useState, type FormEvent } from 'react';
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

export function NewDecisionDialog({
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createDecision(workspaceId, {
        title,
        area: area.trim() || null,
        descriptionMd: description || null,
      });
      setTitle('');
      setArea('');
      setDescription('');
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create decision');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New decision</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New decision</DialogTitle>
          <DialogDescription>
            Log a decision your team is weighing or has made. You can add the RACI, resources, and
            links after it is created.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="decision-title">Title</Label>
            <Input
              id="decision-title"
              required
              maxLength={500}
              placeholder="What is being decided?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="decision-area">Area</Label>
            <Input
              id="decision-area"
              maxLength={200}
              placeholder="Optional grouping, e.g. Billing or Q3 Roadmap"
              value={area}
              onChange={(e) => setArea(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="decision-description">Context</Label>
            <Textarea
              id="decision-description"
              rows={4}
              placeholder="Background, the options weighed, and the reasoning (markdown)."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create decision'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
