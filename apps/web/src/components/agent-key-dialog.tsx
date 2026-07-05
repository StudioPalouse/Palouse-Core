'use client';

import { useState } from 'react';
import type { AgentKeyScope } from '@palouse/shared';
import { ALL_AGENT_KEY_SCOPES, WILDCARD_SCOPE } from '@palouse/shared';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Label,
  Switch,
} from '@palouse/ui';
import { Check, Copy, Download } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { SCOPE_LABELS } from '@/lib/agent-meta';

// Baked at build time (fly/web*.toml build args). Empty in self-hosted builds
// that have not set NEXT_PUBLIC_MCP_URL; the UI shows a placeholder then.
const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL ?? '';
const MCP_URL_PLACEHOLDER = 'https://your-palouse-host/mcp';
// Distinct client alias per environment, so connecting staging and prod side
// by side does not collide in the local MCP config.
const MCP_ALIAS = MCP_URL.includes('mcp-test.') ? 'palouse-test' : 'palouse';

function claudeCodeSnippet(plaintext: string): string {
  const url = MCP_URL || MCP_URL_PLACEHOLDER;
  return `claude mcp add --transport http ${MCP_ALIAS} ${url} --header "Authorization: Bearer ${plaintext}"`;
}

function httpConfigSnippet(plaintext: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_ALIAS]: {
          type: 'http',
          url: MCP_URL || MCP_URL_PLACEHOLDER,
          headers: { Authorization: `Bearer ${plaintext}` },
        },
      },
    },
    null,
    2,
  );
}

function stdioConfigSnippet(plaintext: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_ALIAS]: {
          command: 'palouse-mcp',
          args: ['--stdio'],
          env: { PALOUSE_API_KEY: plaintext },
        },
      },
    },
    null,
    2,
  );
}

// Recommended project instructions so Claude reaches for Palouse on its own
// instead of waiting to be told. Built from lines to keep the markdown backticks
// out of a template literal.
const CLAUDE_MD_SNIPPET = [
  '## Palouse',
  'My tasks and decisions live in Palouse, connected here over MCP.',
  '',
  '- When I mention my tasks, my work, or what to do next, call `list_tasks` to see what is queued for me before asking me to restate it.',
  '- Before working a task, call `get_task` to read its full description and comments.',
  '- Keep task status current with `update_task` as you work, and register work I hand you in chat with `create_task`.',
  '- Treat Palouse as the source of truth for what I have asked you to do. Do not ask me to repeat work that is already tracked there.',
].join('\n');

// Same guidance packaged as a Claude skill the user can drop into their project.
const SKILL_MD = [
  '---',
  'name: palouse',
  'description: Keep work in sync with Palouse. Use whenever the user refers to their tasks, their work, or what to do next, or when starting or finishing work that should be tracked. Reads and updates tasks and decisions through the Palouse MCP tools.',
  '---',
  '',
  '# Palouse task and decision sync',
  '',
  "The user's tasks and decision records live in Palouse, connected over MCP.",
  '',
  '## When the user refers to their work, their tasks, or what to do next',
  '- Call `list_tasks` to see what is queued for them before asking them to restate it.',
  "- Call `get_task` to read a task's full description and comments before acting on it.",
  '',
  '## While working',
  '- Keep status current with `update_task`.',
  '- If the user hands you work directly in chat, register it with `create_task`.',
  '- Log meaningful steps and report token usage with the Palouse tools as you go, then finish with `complete_task` (or `fail_task` if you cannot).',
  '',
  '## Decisions',
  '- When a discussion produces a decision worth tracking, record it with `create_decision`. Search `list_decisions` first so you update an existing record instead of duplicating it.',
  '',
  'Treat Palouse as the source of truth for what the user has asked you to do. Do not ask the user to repeat work that is already recorded there.',
].join('\n');

function downloadSkill() {
  const blob = new Blob([SKILL_MD], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'SKILL.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable; user can select manually */
        }
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function AgentKeyDialog({
  workspaceId,
  agentId,
  onCreated,
}: {
  workspaceId: string;
  agentId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Full access mints a wildcard ('*') key that stays valid as new capabilities
  // ship. Turn it off to pick a fixed granular subset instead.
  const [fullAccess, setFullAccess] = useState(true);
  const [scopes, setScopes] = useState<AgentKeyScope[]>([...ALL_AGENT_KEY_SCOPES]);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setFullAccess(true);
    setScopes([...ALL_AGENT_KEY_SCOPES]);
    setPlaintext(null);
    setError(null);
    setSubmitting(false);
  }

  function toggle(scope: AgentKeyScope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  const canCreate = fullAccess || scopes.length > 0;

  async function create() {
    if (!canCreate) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: AgentKeyScope[] = fullAccess ? [WILDCARD_SCOPE] : scopes;
      const { plaintext } = await api.createAgentKey(workspaceId, agentId, { scopes: payload });
      setPlaintext(plaintext);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create key');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Create key</Button>
      </DialogTrigger>
      <DialogContent>
        {plaintext === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Choose what this key can do. You can revoke it at any time.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="flex items-start justify-between gap-4">
                <div className="grid gap-1">
                  <Label htmlFor="full-access">Full access</Label>
                  <p className="text-muted-foreground text-xs">
                    Works with every capability, including ones added later, so the key keeps
                    working without a re-issue.
                  </p>
                </div>
                <Switch id="full-access" checked={fullAccess} onCheckedChange={setFullAccess} />
              </div>
              {!fullAccess && (
                <div className="grid gap-2">
                  <Label>Scopes</Label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_AGENT_KEY_SCOPES.map((scope) => {
                      const on = scopes.includes(scope);
                      return (
                        <button
                          key={scope}
                          type="button"
                          onClick={() => toggle(scope)}
                          className={cn(
                            'rounded-full border px-3 py-1 text-xs transition-colors',
                            on
                              ? 'bg-primary text-primary-foreground border-transparent'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {SCOPE_LABELS[scope]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <DialogFooter>
              <Button onClick={() => void create()} disabled={submitting || !canCreate}>
                {submitting ? 'Creating…' : 'Create key'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Copy your API key now</DialogTitle>
              <DialogDescription>
                This is the only time the full key is shown. Store it somewhere safe.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label>API key</Label>
                <code className="bg-muted block overflow-x-auto rounded-md px-3 py-2 text-xs">
                  {plaintext}
                </code>
                <CopyButton value={plaintext} label="Copy key" />
              </div>
              <div className="grid gap-2">
                <Label>Connect Claude Code</Label>
                <pre className="bg-muted overflow-x-auto rounded-md px-3 py-2 text-xs whitespace-pre-wrap break-all">
                  {claudeCodeSnippet(plaintext)}
                </pre>
                <CopyButton value={claudeCodeSnippet(plaintext)} label="Copy command" />
                <p className="text-muted-foreground text-xs">
                  Once connected, your agent can register work you give it directly in chat: it
                  creates the task in Palouse and reports its steps, cost, and result here.
                </p>
                {!MCP_URL && (
                  <p className="text-muted-foreground text-xs">
                    Replace {MCP_URL_PLACEHOLDER} with your instance&apos;s MCP endpoint.
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label>Other MCP clients (HTTP)</Label>
                <pre className="bg-muted overflow-x-auto rounded-md px-3 py-2 text-xs">
                  {httpConfigSnippet(plaintext)}
                </pre>
                <CopyButton value={httpConfigSnippet(plaintext)} label="Copy config" />
                <p className="text-muted-foreground text-xs">
                  Self-hosting next to the database? You can run the server locally instead:
                  configure <code>palouse-mcp --stdio</code> with this key in{' '}
                  <code>PALOUSE_API_KEY</code>.
                </p>
                <CopyButton value={stdioConfigSnippet(plaintext)} label="Copy stdio config" />
              </div>
              <div className="grid gap-2">
                <Label>Make your agent use Palouse on its own</Label>
                <p className="text-muted-foreground text-xs">
                  By default an agent waits to be told to check Palouse. Add this to your
                  project&apos;s <code>CLAUDE.md</code> so it reads your tasks and keeps them
                  current without being asked.
                </p>
                <pre className="bg-muted overflow-x-auto rounded-md px-3 py-2 text-xs whitespace-pre-wrap">
                  {CLAUDE_MD_SNIPPET}
                </pre>
                <div className="flex flex-wrap gap-2">
                  <CopyButton value={CLAUDE_MD_SNIPPET} label="Copy instructions" />
                  <Button type="button" variant="outline" size="sm" onClick={downloadSkill}>
                    <Download className="size-4" />
                    Download skill
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  Prefer a skill? Save the download as <code>.claude/skills/palouse/SKILL.md</code>{' '}
                  in your project and Claude loads it automatically when it is relevant.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
