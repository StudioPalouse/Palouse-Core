/**
 * Shared Fieldwork chart styling. Series colors, grid, axes, and tooltip surface
 * all come from design tokens (--chart-1..5, --color-*) instead of per-chart
 * props, so every chart in the app reads as one family in both themes. New charts
 * (for example the future agents dashboard) should pull from here rather than
 * hardcoding colors. See docs/design-system.md section 3.3.
 */

/**
 * The five categorical slots, assigned in fixed order and never cycled. A sixth
 * series should fold into "Other" or small multiples rather than wrap the ramp;
 * seriesColor wraps only as a last-resort guard.
 */
export const CHART_SERIES = [
  'var(--color-chart-1)', // fern
  'var(--color-chart-2)', // wheat
  'var(--color-chart-3)', // sky
  'var(--color-chart-4)', // clay
  'var(--color-chart-5)', // lupine
] as const;

/** Series color for slot i, guarding against an out-of-range index. */
export function seriesColor(i: number): string {
  return CHART_SERIES[i % CHART_SERIES.length] ?? CHART_SERIES[0];
}

/** Axis tick text: small, muted, tokenized. */
export const axisTick = { fontSize: 11, fill: 'var(--color-muted-foreground)' } as const;

/** Bare axis: no line, no tick marks, tokenized label text. */
export const axisProps = {
  tick: axisTick,
  tickLine: false,
  axisLine: false,
} as const;

/** Recessive hairline grid: horizontal lines only, never a full lattice. */
export const gridProps = {
  strokeDasharray: '3 3',
  stroke: 'var(--color-border)',
  vertical: false,
} as const;

/** Tooltip surface matched to popovers/cards so it belongs in both themes. */
export const tooltipStyle = {
  fontSize: 12,
  background: 'var(--color-popover)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-popover-foreground)',
  boxShadow: '0 4px 16px oklch(0.2 0.02 165 / 0.12)',
} as const;

export const tooltipLabelStyle = { color: 'var(--color-muted-foreground)' } as const;

/** Hover cursor fill for categorical (bar) charts. */
export const cursorFill = { fill: 'var(--color-accent)' } as const;

/** Endpoint / active dot: series-colored with a surface ring so it reads on any fill. */
export function endpointDot(color: string) {
  return { r: 3, fill: color, stroke: 'var(--color-background)', strokeWidth: 2 } as const;
}
