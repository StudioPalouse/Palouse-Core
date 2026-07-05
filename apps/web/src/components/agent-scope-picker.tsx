'use client';

import type { AgentKeyScope } from '@palouse/shared';
import { ALL_AGENT_KEY_SCOPES } from '@palouse/shared';
import { cn, Label, Switch } from '@palouse/ui';
import { SCOPE_LABELS } from '@/lib/agent-meta';

/**
 * Full-access switch plus the granular scope pills shown when it is off.
 * Full access mints a wildcard ('*') key that stays valid as new capabilities
 * ship; granular keys are a fixed subset chosen here.
 */
export function AgentScopePicker({
  fullAccess,
  onFullAccessChange,
  scopes,
  onToggleScope,
}: {
  fullAccess: boolean;
  onFullAccessChange: (on: boolean) => void;
  scopes: AgentKeyScope[];
  onToggleScope: (scope: AgentKeyScope) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <Label htmlFor="full-access">Full access</Label>
          <p className="text-muted-foreground text-xs">
            Works with every capability, including ones added later, so the key keeps working
            without a re-issue.
          </p>
        </div>
        <Switch id="full-access" checked={fullAccess} onCheckedChange={onFullAccessChange} />
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
                  onClick={() => onToggleScope(scope)}
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
  );
}
