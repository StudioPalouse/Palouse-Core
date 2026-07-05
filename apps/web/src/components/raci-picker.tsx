'use client';

import type { RaciRole, StakeholderAssignment, WorkspaceMember } from '@palouse/shared';
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@palouse/ui';
import { RACI_LABELS, RACI_ORDER } from '@/lib/decision-meta';

const NONE = 'none';

/**
 * Assign each active workspace member a single RACI role (or none). The schema
 * allows a person to hold several roles, but one-per-member keeps the editor
 * simple and covers the common case; the API and MCP still accept multi-role
 * rosters. At most one Accountable is allowed and is surfaced inline.
 */
export function RaciPicker({
  members,
  value,
  onChange,
}: {
  members: WorkspaceMember[];
  value: StakeholderAssignment[];
  onChange: (next: StakeholderAssignment[]) => void;
}) {
  const roleByUser = new Map(value.map((s) => [s.userId, s.role]));
  const accountableCount = value.filter((s) => s.role === 'accountable').length;

  function setRole(userId: string, role: RaciRole | null) {
    const next = value.filter((s) => s.userId !== userId);
    if (role) next.push({ userId, role });
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {accountableCount > 1 && (
        <p className="text-destructive text-xs">
          A decision can have only one Accountable. Reassign the extras before saving.
        </p>
      )}
      {members.length === 0 && (
        <p className="text-muted-foreground text-sm">No active members to assign.</p>
      )}
      {members.map((m) => {
        const current = roleByUser.get(m.userId) ?? NONE;
        return (
          <div key={m.userId} className="flex items-center gap-3">
            <Label className="flex-1 truncate font-normal">{m.name || m.email}</Label>
            <Select
              value={current}
              onValueChange={(v) => setRole(m.userId, v === NONE ? null : (v as RaciRole))}
            >
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {RACI_ORDER.map((r) => (
                  <SelectItem key={r} value={r}>
                    {RACI_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
