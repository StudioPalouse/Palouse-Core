'use client';

import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import type { ObjectiveImportResult } from '@palouse/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@palouse/ui';
import { api, ApiError } from '@/lib/api';

const TEMPLATE_HEADER =
  'objective_title,description,area,status,target_date,kr_name,kr_start,kr_target,kr_current,kr_unit';
const TEMPLATE_ROWS = [
  'Grow signups,Q3 growth goal,Growth,active,2026-09-30,Weekly signups,100,500,250,',
  'Grow signups,,,,,Activation rate,20,60,35,%',
  'Improve NPS,Raise customer satisfaction,CX,at_risk,2026-12-31,NPS,30,50,42,',
];

/** Trigger a client-side download of the CSV template so users have the shape. */
function downloadTemplate() {
  const blob = new Blob([[TEMPLATE_HEADER, ...TEMPLATE_ROWS].join('\n') + '\n'], {
    type: 'text/csv',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'palouse-objectives-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });
}

export function ImportObjectivesDialog({
  workspaceId,
  onImported,
}: {
  workspaceId: string;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<ObjectiveImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ObjectiveImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFileName(null);
    setCsv(null);
    setPreview(null);
    setError(null);
    setDone(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPreview(null);
    setDone(null);
    setFileName(file.name);
    setBusy(true);
    try {
      const text = await readFileText(file);
      setCsv(text);
      const result = await api.importObjectives(workspaceId, text, true);
      setPreview(result);
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : 'Could not read file',
      );
      setCsv(null);
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!csv) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importObjectives(workspaceId, csv, false);
      setDone(result);
      onImported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="size-3.5" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import objectives</DialogTitle>
          <DialogDescription>
            Upload a CSV to create objectives and their key results in one go. Use one row per key
            result, repeating the objective_title to group them.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              Created {done.objectiveCount} {done.objectiveCount === 1 ? 'objective' : 'objectives'}{' '}
              and {done.keyResultCount} {done.keyResultCount === 1 ? 'key result' : 'key results'}.
            </p>
            {done.errors.length > 0 && (
              <p className="text-muted-foreground">
                {done.errors.length} {done.errors.length === 1 ? 'row was' : 'rows were'} skipped.
              </p>
            )}
            <DialogFooter>
              <Button size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="text-muted-foreground file:bg-muted file:text-foreground hover:file:bg-accent block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-sm"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={downloadTemplate}
                className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-xs underline underline-offset-2"
              >
                <Download className="size-3.5" />
                Template
              </button>
            </div>

            {busy && !preview && (
              <p className="text-muted-foreground text-sm">Reading {fileName}…</p>
            )}
            {error && <p className="text-destructive text-sm">{error}</p>}

            {preview && (
              <div className="flex flex-col gap-3">
                <div className="bg-muted/50 rounded-md border p-3 text-sm">
                  <p className="font-medium">
                    {preview.objectiveCount}{' '}
                    {preview.objectiveCount === 1 ? 'objective' : 'objectives'} and{' '}
                    {preview.keyResultCount}{' '}
                    {preview.keyResultCount === 1 ? 'key result' : 'key results'} ready to import.
                  </p>
                  {preview.errors.length > 0 && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {preview.errors.length} {preview.errors.length === 1 ? 'row' : 'rows'} will be
                      skipped (see below).
                    </p>
                  )}
                </div>

                {preview.errors.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto rounded-md border text-xs">
                    {preview.errors.map((e, i) => (
                      <li key={i} className="border-b px-3 py-1.5 last:border-b-0">
                        <span className="text-muted-foreground">
                          {e.row > 0 ? `Row ${e.row}: ` : ''}
                        </span>
                        {e.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <DialogFooter>
              <Button
                size="sm"
                disabled={busy || !preview || preview.objectiveCount === 0}
                onClick={() => void runImport()}
              >
                {busy && preview
                  ? 'Importing…'
                  : preview
                    ? `Import ${preview.objectiveCount} ${preview.objectiveCount === 1 ? 'objective' : 'objectives'}`
                    : 'Import'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
