'use client';

import type { HandoffUsageSummary } from '@reqops/shared';
import { Badge, Card, CardContent } from '@reqops/ui';
import { formatTokens, formatUsd } from '@/lib/handoff-meta';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className="text-lg font-semibold tracking-tight">{value}</span>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      </CardContent>
    </Card>
  );
}

/** Duration · Models · Tokens · Cost — the auditor-facing summary strip. */
export function UsageSummaryCards({
  summary,
  durationLabel,
}: {
  summary: HandoffUsageSummary;
  durationLabel: string | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Duration" value={durationLabel ?? '—'} />
        <Stat
          label="Models used"
          value={summary.models.length === 0 ? '—' : String(summary.models.length)}
          hint={summary.models.join(', ') || undefined}
        />
        <Stat
          label="Tokens"
          value={
            summary.generationCount === 0
              ? '—'
              : `${formatTokens(summary.inputTokens)} in / ${formatTokens(summary.outputTokens)} out`
          }
          hint={
            summary.cacheReadTokens > 0
              ? `${formatTokens(summary.cacheReadTokens)} cached reads`
              : undefined
          }
        />
        <Stat
          label="Cost"
          value={summary.costUsd === null ? (summary.generationCount === 0 ? '—' : 'Unpriced') : formatUsd(summary.costUsd)}
          hint={`${summary.generationCount} LLM call${summary.generationCount === 1 ? '' : 's'}`}
        />
      </div>
      {summary.unpricedCount > 0 && summary.costUsd !== null && (
        <Badge variant="outline" className="self-start">
          Includes {summary.unpricedCount} unpriced call{summary.unpricedCount === 1 ? '' : 's'}
        </Badge>
      )}
    </div>
  );
}
