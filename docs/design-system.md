# Fieldwork: the Palouse design language

Status: **adopted** (July 2026). This document is the record of the design-direction
decision and the reference spec for implementing it. The visual proposal this records
was reviewed as a rendered artifact; this file is the durable, in-repo version.

Decision in one line: keep the shadcn/ui architecture we already own and grow a
Palouse-specific design language (working name **Fieldwork**) on top of it, instead of
adopting another design system or re-skinning with a component kit.

---

## 1. Why this exists

Goal: stop reading as "another stock shadcn app" and move toward the feel of a serious
enterprise product (reference point: Celonis) while staying professional yet playful,
themed around growing while maintaining critical operations, tasks, and goals.

Audit findings that motivated the change (state of the repo, July 2026):

- Light-mode color tokens in `apps/web/src/app/globals.css` were byte-for-byte shadcn
  neutral defaults. All brand identity lived in the dark theme (forest-green tint,
  oklch hue 165, hand-tuned across all tokens).
- No custom fonts. The app rendered in the OS system font stack.
- No chart color tokens; every Recharts series used `--color-primary`.
- `packages/ui` primitives essentially verbatim shadcn new-york. Existing opinions
  worth keeping: pill badges, the semantic status convention in `lib/*-meta.ts`
  (sky/amber/rose/emerald), the custom sidebar shell.

The Celonis lesson we are copying structurally, not visually: a disciplined neutral
base, very few expressive colors that also drive data visualization, one workhorse
typeface set well, and playfulness confined to dataviz, illustration, and empty
states. Distinctiveness is a token-and-dataviz discipline, not a component library.

## 2. Alternatives evaluated and rejected

| Option | Verdict | Why |
|---|---|---|
| Adopt IBM Carbon / Atlassian DS / Fluent 2 / Polaris / Primer | Rejected as base; borrow ideas | Months of rewrite to end up wearing another company's brand. Carbon dataviz guidance and Atlassian token architecture remain reference material. |
| Base Web (Uber) | Rejected | Maintenance mode. |
| Re-skin with a kit or preset (HeroUI, Untitled UI, tweakcn presets) | Rejected | Fast but shallow: trades "stock shadcn" for "stock something else", plus a second component system to maintain. Untitled UI and Origin/COSS stay useful as sources to copy individual complex components from. |
| Tremor | Adopt pieces | Chart wrappers and dashboard blocks over Recharts, restyled with our tokens. |
| tweakcn | Adopt as tool | Live workbench for iterating token values. Do not ship a preset. |
| Ground-up custom system | Rejected | Our problem is visual language, not component anatomy. |

## 3. The Fieldwork language

The Palouse region is rolling hills of wheat and lentils: green in spring, gold at
harvest, worked in long contour lines. Operations are the field you maintain; goals
are the harvest you grow toward. Professional discipline and organic warmth come from
the same metaphor.

Guardrail: **professional to playful is roughly 90/10.** The playful budget is spent
only in dataviz color, empty states, progress moments, and the horizon motif. Tables,
forms, dialogs, and settings stay strictly disciplined. If a screen feels whimsical,
it is over budget.

### 3.1 Color

Principles:

- Promote the hue-165 green out of dark mode. It becomes the brand primary in both
  themes.
- Harvest gold is the secondary accent, reserved for emphasis, progress, and growth
  moments only. It never becomes a general-purpose interactive color.
- Every neutral (backgrounds, borders, muted text) carries a 1 to 3 percent tint of
  the same green hue so even the grays are ours.
- The existing status convention stays and gets formalized as tokens instead of
  hardcoded Tailwind classes: sky = open/planning, amber = in progress/at risk,
  rose = blocked/rejected, emerald = done/achieved, blue = active.

Named anchors (starting values; final values iterate in tweakcn during Phase 1 and
must pass contrast checks in both themes):

| Name | Role | Light | Dark |
|---|---|---|---|
| Forest | primary | `oklch(0.45 0.09 165)` | `oklch(0.72 0.09 165)` |
| Fern | interactive/bright primary | `oklch(0.52 0.115 165)` (`#007d58`) | `oklch(0.68 0.115 165)` (`#45af86`) |
| Harvest | accent (growth only) | `oklch(0.60 0.125 78)` (`#a97500`) | `oklch(0.75 0.125 82)` (`#d5a546`) |
| Loam | page/tinted neutrals | green-tinted off-white (about `oklch(0.975 0.004 165)`) | keep existing dark ramp (background `oklch(0.155 0.024 165)`, card `oklch(0.215 0.03 165)`) |
| Pine ink | text | green-tinted near-black (about `oklch(0.2 0.01 165)`) | `oklch(0.97 0.01 165)` (existing) |

The existing hand-tuned dark theme in `globals.css` is the reference for the dark
ramp; light mode is rebuilt to match it rather than the other way around.

### 3.2 Typography

Carbon's approach, literally including Carbon's family:

- **IBM Plex Sans** for everything: headings, body, UI. Loaded via `next/font` in
  `apps/web/src/app/layout.tsx`. One family; hierarchy comes from size and weight,
  never from a second voice.
- Weights: 600 for headings and stat values, 400 to 500 for body and UI. No display
  face. Keep `tracking-tight` on large sizes only.
- **IBM Plex Mono** for code, task IDs, and agent identifiers.
- Numbers in stat tiles and table columns set `tabular-nums`.
- Keep the existing `html { font-size: 103% }` rule; it composes fine with loaded
  fonts.
- Rationale for dropping the earlier display-face proposal (Bricolage Grotesque):
  too warm for long data-dense sessions, and a single family simplifies contrast
  auditing and font loading. With type this quiet, personality is carried entirely
  by color, the horizon motif, and dataviz (the Celonis pattern).
- Alternates if Plex ever reads too close to IBM's own products: Source Sans 3 or
  Public Sans. Avoid Inter and Space Grotesk (the generic defaults of this era).
  Both Plex families are SIL OFL and available through `next/font/google`.

### 3.3 Data visualization

This is where the brand smiles. Five categorical slots, assigned in fixed order,
never cycled. A sixth series folds into "Other" or small multiples.

| Slot | Name | Light (on white) | Dark (on card `#0b1e16`) |
|---|---|---|---|
| chart-1 | fern | `#007d58` | `#329f78` |
| chart-2 | wheat | `#a97500` | `#b88923` |
| chart-3 | sky | `#3d7dc4` | `#4f8ac6` |
| chart-4 | clay | `#c0603f` | `#c26b4c` |
| chart-5 | lupine | `#7a5fae` | `#977cc5` |

Both palettes are machine-validated (colorblind separation, lightness band, chroma
floor, surface contrast): worst adjacent CVD delta-E 38.8 in light and 43.1 in dark
(target is 12 or more); every slot clears 3:1 contrast on its surface. If any hex
changes, re-validate before shipping.

Mark and style rules for all charts:

- 2px lines, endpoint dot with a 2px surface ring, selective direct labels (never a
  number on every point), recessive hairline grid, one axis (never dual-axis).
- A legend is always present for two or more series; text wears text tokens, never
  the series color.
- Sequential data uses a one-hue fern ramp. Status colors are never reused as series
  colors.
- Wire the palette in as `--chart-1..5` tokens and build Tremor-style wrappers over
  the existing Recharts setup so series colors, tooltips, and grid styling come from
  tokens instead of per-chart props.

### 3.4 Component posture

The primitives in `packages/ui` keep their APIs. What changes:

- Slightly larger radius on containers; hairline green-tinted borders.
- Tinted shadows (green-cast, not gray).
- Gold appears only on growth and progress elements.
- Badges stay pill-shaped (existing opinion, kept).

### 3.5 Signature elements

- **The horizon line.** A low rolling-hills curve as the footer of stat cards and the
  backdrop of empty states, at 8 to 13 percent opacity. It appears in exactly those
  two places in the app; it is never a loud hero.
- **Growth progress.** Objective progress bars grow toward green: the fill runs
  gold-to-forest so the leading edge, and a completed bar, land on the same green
  that means "done/achieved" elsewhere in the app. (This reverses the earlier
  forest-to-gold direction after review; ending on green reads more clearly as
  complete.) At 100 percent, a one-time 400ms ease-out sweep crosses the bar. That
  is the entire playful budget for the component.
- **Brand mark.** Keep the existing circular rolling-hills mark (green gradient
  with white contour lines, raster PNG in `apps/web/public/brand/`). An SVG
  redraw was tried and reverted: the circular mark is the established logo and
  reads well on both themes as-is.
- **Empty states become moments.** Dashed gray boxes become small horizon
  illustrations with quiet Plex headlines (for example "Nothing planted here yet").

### 3.6 Motion

- Keep `tw-animate-css` for overlay enter/exit.
- Add exactly two custom keyframes: the progress fill sweep and a staggered 150ms
  card fade-up on dashboard load. No motion library.
- Respect `prefers-reduced-motion` throughout.

## 4. Rollout plan

Each phase is shippable alone.

1. **Foundation (1 to 2 days).** Load IBM Plex Sans + IBM Plex Mono via `next/font`
   in `apps/web/src/app/layout.tsx`. Rewrite light-mode tokens in
   `apps/web/src/app/globals.css` (green-tinted neutrals, Forest primary, Harvest
   accent); rebalance the dark theme to match. Add `--chart-1..5` and semantic status
   tokens.
2. **Data visualization (2 to 3 days).** Retheme
   `apps/web/src/components/spend-charts.tsx` onto chart tokens; add Tremor-style
   wrappers for the future agents dashboard. Migrate hardcoded status classes in
   `apps/web/src/lib/{task,project,objective,decision}-meta.ts` to tokens.
3. **Signature surfaces (3 to 5 days).** SVG brand mark; horizon element on stat
   cards and empty states. Dashboard, handoff detail, and auth pages first, then task
   lists and the projects board. Growth-styled progress in `objective-list` and the
   dashboard objectives card.
4. **Motion and polish (2 to 3 days).** Progress sweep and dashboard stagger
   keyframes; hover states on rows and cards; contrast audit of both themes; update
   the stale design notes in `README.md` (it still claims a stock theme and top-bar
   navigation).

## 5. References

- Celonis Studio color theming: https://docs.celonis.com/en/2442167.html
- Celonis product UI case study (SNK): https://www.snk.de/en/projects/celonis-ui/
- IBM Carbon (dataviz guidance, type scale): https://carbondesignsystem.com
- Atlassian Design System (token architecture, motion): https://atlassian.design
- shadcn theming: https://ui.shadcn.com/docs/theming
- Tremor: https://tremor.so
- tweakcn: https://tweakcn.com
