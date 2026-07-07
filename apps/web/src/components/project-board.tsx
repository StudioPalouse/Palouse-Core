'use client';

import { useState, type DragEvent } from 'react';
import { Bot, Check, MoreHorizontal, Plus } from 'lucide-react';
import type { ProjectColumn, ProjectDetail, ProjectItemWithLinks } from '@palouse/shared';
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from '@palouse/ui';

const RANK_STEP = 1000;

/** Position that drops a card at the end of a column's current ordering. */
function endPosition(items: ProjectItemWithLinks[]): number {
  const last = items[items.length - 1];
  return (last ? last.position : 0) + RANK_STEP;
}

/** Position that inserts a dragged card immediately before `target`. */
function beforePosition(items: ProjectItemWithLinks[], targetIndex: number): number {
  const target = items[targetIndex];
  const prev = items[targetIndex - 1];
  if (!target) return endPosition(items);
  return prev ? (prev.position + target.position) / 2 : target.position - RANK_STEP;
}

export function ProjectBoard({
  detail,
  onSelectItem,
  onMoveItem,
  onAddItem,
  onAddColumn,
  onRenameColumn,
  onToggleDoneColumn,
  onDeleteColumn,
}: {
  detail: ProjectDetail;
  onSelectItem: (id: string) => void;
  onMoveItem: (itemId: string, columnId: string, position: number) => void;
  onAddItem: (columnId: string, title: string) => void;
  onAddColumn: (name: string) => void;
  onRenameColumn: (columnId: string, name: string) => void;
  onToggleDoneColumn: (column: ProjectColumn) => void;
  onDeleteColumn: (columnId: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  const itemsByColumn = new Map<string, ProjectItemWithLinks[]>();
  for (const col of detail.columns) itemsByColumn.set(col.id, []);
  for (const item of detail.items) itemsByColumn.get(item.columnId)?.push(item);

  function drop(columnId: string, position: number) {
    if (dragId) onMoveItem(dragId, columnId, position);
    setDragId(null);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {detail.columns.map((col) => {
        const items = itemsByColumn.get(col.id) ?? [];
        return (
          <div
            key={col.id}
            className="bg-muted/40 flex w-72 shrink-0 flex-col gap-2 rounded-lg border p-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(col.id, endPosition(items))}
          >
            <ColumnHeader
              column={col}
              count={items.length}
              onRename={(name) => onRenameColumn(col.id, name)}
              onToggleDone={() => onToggleDoneColumn(col)}
              onDelete={() => onDeleteColumn(col.id)}
            />
            <div className="flex min-h-2 flex-col gap-2">
              {items.map((item, i) => (
                <Card
                  key={item.id}
                  item={item}
                  onDragStart={() => setDragId(item.id)}
                  onDropBefore={(e) => {
                    e.stopPropagation();
                    drop(col.id, beforePosition(items, i));
                  }}
                  onClick={() => onSelectItem(item.id)}
                />
              ))}
            </div>
            <AddCard onAdd={(title) => onAddItem(col.id, title)} />
          </div>
        );
      })}
      <AddColumn onAdd={onAddColumn} />
    </div>
  );
}

function ColumnHeader({
  column,
  count,
  onRename,
  onToggleDone,
  onDelete,
}: {
  column: ProjectColumn;
  count: number;
  onRename: (name: string) => void;
  onToggleDone: () => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);

  if (renaming) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onRename(name.trim());
          setRenaming(false);
        }}
      >
        <Input
          className="h-7"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setRenaming(false)}
        />
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-1">
      <span className="truncate text-sm font-medium">{column.name}</span>
      {column.isDone && (
        <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Done column" />
      )}
      <span className="text-muted-foreground text-xs tabular-nums">{count}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Column actions"
            className="text-muted-foreground hover:text-foreground ml-auto"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setName(column.name);
              setRenaming(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleDone}>
            {column.isDone ? 'Unmark as done column' : 'Mark as done column'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            Delete column
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Card({
  item,
  onDragStart,
  onDropBefore,
  onClick,
}: {
  item: ProjectItemWithLinks;
  onDragStart: () => void;
  onDropBefore: (e: DragEvent) => void;
  onClick: () => void;
}) {
  const linkCount = item.linkedTasks.length + item.linkedDecisions.length;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropBefore}
      onClick={onClick}
      className={cn(
        'bg-background hover:border-primary/40 cursor-pointer rounded-md border p-2 text-sm shadow-sm transition-colors',
        item.completedAt && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-1.5">
        {item.completedAt && (
          <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <span className={cn('min-w-0 flex-1', item.completedAt && 'line-through')}>
          {item.title}
        </span>
        {item.origin === 'agent' && (
          <Bot className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-label="Agent created" />
        )}
      </div>
      {linkCount > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.linkedTasks.length > 0 && (
            <Badge variant="outline" className="text-[11px]">
              {item.linkedTasks.length} task{item.linkedTasks.length === 1 ? '' : 's'}
            </Badge>
          )}
          {item.linkedDecisions.length > 0 && (
            <Badge variant="outline" className="text-[11px]">
              {item.linkedDecisions.length} decision{item.linkedDecisions.length === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function AddCard({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground justify-start"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3.5" />
        Add card
      </Button>
    );
  }

  function submit() {
    if (title.trim()) onAdd(title.trim());
    setTitle('');
    setOpen(false);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-1.5"
    >
      <Input
        className="h-8"
        autoFocus
        placeholder="Card title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => (title.trim() ? submit() : setOpen(false))}
      />
    </form>
  );
}

function AddColumn({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:bg-muted/40 hover:text-foreground flex h-9 w-56 shrink-0 items-center gap-2 rounded-lg border border-dashed px-3 text-sm transition-colors"
      >
        <Plus className="size-4" />
        Add column
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onAdd(name.trim());
        setName('');
        setOpen(false);
      }}
      className="w-56 shrink-0"
    >
      <Input
        className="h-9"
        autoFocus
        placeholder="Column name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setOpen(false)}
      />
      <button type="submit" className="sr-only" aria-hidden>
        Add
      </button>
    </form>
  );
}
