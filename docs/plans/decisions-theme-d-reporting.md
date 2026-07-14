# Theme D: Reporting and analytics — implementation plan

> **Backlog tracked in Specboard.** This work is the **Theme D — Reporting** epic (release
> **Decisions: Reporting**) in the **Decisions Capability Expansion** initiative; its slices are
> the features D1 through D7. Specboard owns scope and status; this document is retained as
> build-time implementation reference. Reconciled 2026-07-14.

Status: proposal (2026-07-11). Parent: `docs/decisions-roadmap.md` (goal 4, "Enable
reporting around decisions"). This plan is self-contained: it names the exact files,
tables, and functions to touch, verified against the codebase on 2026-07-11.

**Resolved 2026-07-11 (open question: single vs recurring outcome review):**
configurable per decision. A decision carries its own review configuration (a review
date and an optional recurring cadence), so some decisions get one retrospective and
others get a repeating check-in. This confirms the separate `decision_outcomes` table
(rather than inline columns) since one decision can accrue multiple outcome records over
time; add the per-decision review-config fields (review_at, review_cadence) alongside it.

## 1. Title, goal, roadmap goals served

**Goal (one line):** turn the decision log into a reporting surface. Show how decisions
move (velocity, aging), whether they worked (outcome review), and how far they reached
(rollout acknowledgement), all query-driven with no new heavy infrastructure.

**Roadmap goals served:** goal 4 (reporting) is the primary. It also feeds goal 5
(strategy linkage): a decision dashboard is where "open decisions blocking at-risk key
results" (E3) eventually surfaces, and outcome quality is a strategy signal.

Theme D covers four sub-features from the roadmap:

- **D1 Decision dashboard** — counts by status/area, time-to-decision, aging under-review
  decisions, stakeholder participation.
- **D2 Outcome review** — the Cloverpop "Decision Bank" pattern: capture an expected
  outcome and a review date at decision time; a scheduled job prompts the Accountable at
  review time to record the actual outcome (worked / mixed / did not work) with a note.
- **D3 Decision register export** — CSV/report of decisions by area/quarter with
  stakeholders and outcomes.
- **D4 Rollout reach reporting** — acknowledgement rates per decision and per team,
  sourced from Theme C's `decision_acknowledgements`.

**Differentiation (verified market context):** the Cloverpop rationale-plus-outcome loop
(D2) is the only decision-quality pattern found in a surveyed tool. Velocity and aging
metrics (D1) were NOT verified in any surveyed product, so D1 is genuinely novel ground,
not a me-too dashboard. Keep that framing when we position this.

## 2. Prerequisites and dependencies

- **D1 and D2 have no external theme dependency.** Everything they need already exists:
  `decisions.status`, `decisions.decidedAt` (stamped on first terminal outcome, verified
  in `packages/core/src/decisions/service.ts` `updateDecision`), `decisions.area`,
  `decisions.createdAt`, `decisions.updatedAt`, `decisionStakeholders`, and the
  `audit_events` trail (`decision.*` actions with an `at` timestamp).
- **D2's review prompt needs a notification path.** The roadmap puts stakeholder
  notifications in Theme B (B4) and rollout announcements in Theme C (C1). Neither has
  shipped. D2 must NOT block on them. The mail package (`packages/mail/src/index.ts`,
  `sendEmail` + `renderBasicEmail`) already exists and is a logged no-op when
  `RESEND_API_KEY` is unset, so D2 can send its own review-prompt email directly from a
  new housekeeping worker without waiting for a shared notification layer. If Theme B/C
  land a shared notification service first, refactor D2 to route through it then; do not
  gate D2 on it now. In-app surfacing of the prompt (a review-queue card) is the
  degrade-gracefully fallback when mail is disabled.
- **D4 depends on Theme C.** `decision_acknowledgements` and `decision_rollouts` do not
  exist yet (grep confirms no such tables/files on 2026-07-11). D4 must be designed to
  degrade gracefully: the analytics service detects whether the acknowledgement table
  exists / has rows and, if not, the reach section is simply absent from the summary
  payload and the UI hides that card. Ship D4 last, after Theme C.
- **Existing infrastructure this plan reuses (all verified present):**
  - recharts + shared chart theme `apps/web/src/components/charts/chart-theme.ts`
    (`seriesColor`, `axisProps`, `gridProps`, `tooltipStyle`, `endpointDot`,
    `cursorFill`).
  - Chart component precedent `apps/web/src/components/spend-charts.tsx`
    (`AreaChart`/`BarChart` wrappers) and stat-card precedent
    `apps/web/src/components/usage-summary-cards.tsx` (en-dash `–` for empty cells).
  - Capability-aware dashboard `apps/web/src/app/(app)/dashboard/page.tsx` (polls
    `POLL_MS = 20_000`, fail-open capabilities).
  - BullMQ housekeeping queue slot already reserved in `packages/queue/src/index.ts`
    (`QUEUE_NAMES.housekeeping`), plus the `upsertJobScheduler` repeatable-sweep pattern
    (`scheduleReaper` for `handoff.reap_expired`, `scheduleSubscriptionRenewal`).
  - Worker wiring precedent `apps/worker/src/index.ts` + `apps/worker/src/handoffs.ts`
    (`runReapExpired`).
  - `capabilityService.capabilitiesForWorkspace` + `requireDecisionsAccess` middleware
    in `apps/api/src/routes/decisions.ts`.

## 3. Refined sub-feature scope

- **D1 Decision dashboard.** A dedicated Analytics view under Decisions (tab or
  `/decisions/analytics`), plus a compact rollup on the main dashboard. Metrics:
  - Counts by status (all 6 enum values) and by area (top N areas plus "Other").
  - Time-to-decision: median and average days from `created_at` to `decided_at` for
    decisions that reached a terminal outcome (`accepted`/`rejected`, i.e. `decided_at is
    not null`), optionally bucketed by area or quarter.
  - Aging: decisions in `under_review` ordered by how long since `updated_at` (or since
    they entered review, from `audit_events`; see 12 on the accuracy tradeoff), with a
    configurable "stale" threshold.
  - Stakeholder participation: distinct users holding a RACI role across decisions in the
    window; count of decisions with no Accountable assigned (a data-quality signal).
  - Trend: decisions created and decided per week/month over the window.
- **D2 Outcome review.** Add outcome fields to the data model, a record-outcome endpoint,
  a scheduled sweep that finds decisions due for review and prompts the Accountable, and
  a review-queue surface in the UI. Supports the single-review case now; the data model is
  chosen so recurring review is a later, additive change (see 4 and 15).
- **D3 Decision register export.** A server-generated CSV of decisions filtered by
  area and/or quarter, one row per decision, with stakeholders (comma-joined by role) and
  outcome columns. Streamed from the API as `text/csv`. No new dependency: build the CSV
  in-process. A richer (multi-sheet / PDF) export is explicitly out of scope for v1.
- **D4 Rollout reach.** Acknowledgement rate per decision and aggregate per team (teams
  arrive with Theme C's audience model). Wholly dependent on Theme C tables; ship last.

## 4. Data model changes (by content)

Migration numbers are assigned at implementation time. The current max is `0018`; do NOT
hardcode a number here. Follow the house style verified in
`packages/db/src/schema/decisions.ts`: snake_case columns, `gen_random_uuid()` default
ids, `timestamp(..., { withTimezone: true, mode: 'date' })`, enums via `pgEnum`.

### 4a. Decision outcome fields — DECISION: separate table, not inline columns

The roadmap prompt asks us to choose inline columns on `decisions`
(`expected_outcome_md`, `review_at`, `outcome`, `outcome_note_md`, `outcome_recorded_at`)
versus a separate `decision_outcomes` table. **Recommend a separate
`decision_outcomes` table**, because a decision may be reviewed more than once (a 30-day
check and a 6-month check), and the roadmap's own "seed of decision-quality metrics"
framing implies a history of reviews, not a single overwrite. Inline columns force a
destructive overwrite on the second review and lose the first result. A table is
strictly more general and only marginally more code.

The *expected* outcome and the *review date* are properties of the decision at decision
time, so keep those two on `decisions` (they are set once, on accept). The *actual*
outcome is the reviewable, repeatable part, so it goes in the child table.

New columns on `decisions` (add in the migration; also add to the drizzle schema and the
`Decision` DTO + `toDto` mapper in `packages/core/src/decisions/service.ts`):

```ts
// packages/db/src/schema/decisions.ts — added to the decisions table
expectedOutcomeMd: text('expected_outcome_md'),          // nullable
reviewAt: timestamp('review_at', { withTimezone: true, mode: 'date' }), // nullable
```

New table `decision_outcomes` (new `pgEnum` `decision_outcome_result`):

```ts
export const decisionOutcomeResult = pgEnum('decision_outcome_result', [
  'worked',
  'mixed',
  'did_not_work',
]);

export const decisionOutcomes = pgTable(
  'decision_outcomes',
  {
    id: baseId(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    result: decisionOutcomeResult('result').notNull(),
    noteMd: text('note_md'),
    // Which scheduled review this satisfies, so recurring reviews stay distinct.
    reviewAt: timestamp('review_at', { withTimezone: true, mode: 'date' }),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    recordedAt: ts('recorded_at'), // defaults now()
  },
  (t) => ({
    decisionIdx: index('decision_outcomes_decision_idx').on(t.decisionId),
    // For "latest outcome per decision" in aggregation.
    decisionRecordedIdx: index('decision_outcomes_decision_recorded_idx').on(
      t.decisionId,
      t.recordedAt,
    ),
  }),
);
```

"Latest outcome" for quality metrics is the most-recent row per `decision_id` by
`recorded_at`. A decision is "review due" when `decisions.review_at <= now()` and no
`decision_outcomes` row exists with a `review_at` matching the current cycle (for v1
single-review: no outcome row at all).

### 4b. Indexes for aggregation

`decisions` already has `decisions_workspace_idx (workspace_id)` and
`decisions_workspace_status_idx (workspace_id, status)` (verified). For D1 add:

```ts
// aging sweep + "recently updated under_review" scans
workspaceStatusUpdatedIdx: index('decisions_workspace_status_updated_idx')
  .on(t.workspaceId, t.status, t.updatedAt),
// review-due sweep across workspaces (partial-friendly; keep simple for v1)
reviewAtIdx: index('decisions_review_at_idx').on(t.reviewAt),
```

The existing `(workspace_id, status)` index already covers status counts. Time-to-decision
scans `decided_at is not null` within a workspace; the workspace index plus a filter is
fine at platform scale. If profiling later shows it matters, add
`(workspace_id, decided_at)`; do not add it speculatively.

`audit_events` already has `audit_events_workspace_action_idx (workspace_id, action)` and
`audit_events_workspace_at_idx (workspace_id, at)` (verified), which cover any
time-in-status queries derived from the trail.

### 4c. Shared DTOs

In `packages/shared/src/decision.ts`: extend `decisionSchema` with `expectedOutcomeMd`
(nullable) and `reviewAt` (nullable ISO string); add `decisionOutcomeResult` z.enum
(kept in sync with the pg enum, matching the existing comment convention in that file);
add `decisionOutcomeSchema`, `recordOutcomeInput`, and the analytics summary DTOs
(section 6). Update `createDecisionInput`/`updateDecisionInput` to accept
`expectedOutcomeMd` and `reviewAt` so they can be set at accept time.

## 5. Core service layer

Add `packages/core/src/decisions/analytics.ts`, exported from `@palouse/core` as
`decisionAnalyticsService` (a new namespace, keeping the read-heavy aggregation separate
from the mutating `decisionService`). Every function takes `(db, workspaceId, ...)` like
the existing services. **All aggregation is live SQL** (see the justification in section
15); no snapshot table for v1.

Functions:

- `decisionSummary(db, workspaceId, window)` → the D1 payload. Runs a handful of grouped
  queries in `Promise.all`, mirroring the grouped-count pattern already in
  `listDecisions` and the objectives rollup (`sql<number>\`count(*)::int\``, `groupBy`):
  - status counts: `group by status`.
  - area counts: `group by area` (coalesce null area to a sentinel; UI renders null area
    with the en-dash empty-cell convention).
  - time-to-decision: `avg`/`percentile_cont(0.5)` over
    `extract(epoch from (decided_at - created_at))` where `decided_at is not null`,
    converted to days in JS.
  - aging: select `under_review` rows ordered by `updated_at asc`, limited, with a
    computed age in days; flag those older than the stale threshold.
  - participation: distinct `user_id` from `decision_stakeholders` joined to in-window
    decisions; count decisions lacking an `accountable` row.
  - trend: `date_trunc('week', created_at)` created counts and
    `date_trunc('week', decided_at)` decided counts.
- `outcomeSummary(db, workspaceId, window)` → decision-quality counts (worked / mixed /
  did_not_work) computed over the latest outcome per decision, plus count of decisions
  past `review_at` with no outcome recorded.
- `reachSummary(db, workspaceId, window)` (D4) → guarded: if the acknowledgements table
  is absent/empty, return `null` and let callers omit the section. Implement only when
  Theme C lands.
- `recordOutcome(db, workspaceId, actor, decisionId, input)` → mutating; inserts a
  `decision_outcomes` row, writes `audit_events` action `decision.outcome_recorded`
  (reuse the private `audit` helper pattern), and returns the DTO. Lives here or in
  `decisionService`; put it next to the other decision mutations in
  `packages/core/src/decisions/service.ts` for cohesion, and re-export.
- `decisionsDueForReview(db, now)` → cross-workspace scan for the sweep (section 9):
  decisions with `review_at <= now` and no satisfying outcome row; returns id, workspace,
  title, and the Accountable's user id/email (join `decision_stakeholders` +
  `users`).
- `exportRegister(db, workspaceId, filter)` → returns the ordered rows (decision +
  stakeholders grouped by role + latest outcome) that the API serializes to CSV
  (section 6). Keep row shaping here; keep CSV string-building in the API/a small shared
  util so core stays serialization-free.

## 6. API routes

Add to `apps/api/src/routes/decisions.ts` (all behind the existing
`requireSession` + `requireDecisionsAccess(db, workspaceId, userId)`; workspaceId from
query for GETs, from body for POSTs, matching the file's convention):

- `GET /analytics?workspaceId=&from=&to=&area=` → `decisionAnalyticsService.decisionSummary`
  + `outcomeSummary`, and `reachSummary` when available. Returns one combined summary
  object. Validate query with a new `decisionAnalyticsQuery` zod schema
  (window defaults to last 90 days).
- `POST /:id/outcome` → body `{ workspaceId, result, noteMd?, reviewAt? }` validated by
  `recordOutcomeInput`; calls `recordOutcome`; returns `{ outcome }`, 201.
- `GET /export?workspaceId=&area=&quarter=&format=csv` → streams `text/csv` with
  `Content-Disposition: attachment; filename="decisions-<area-or-all>-<quarter-or-all>.csv"`.
  Serializes `exportRegister` rows. `format` reserved for a future `json`; default `csv`.

Analytics and export are read-only, so no MCP scope change beyond `decisions:read`.
`POST /:id/outcome` is a write (`decisions:write`).

## 7. MCP tools (optional)

One optional read tool, `get_decision_analytics`, for agent-driven reporting ("summarize
our Q3 decisions"). Wire it exactly like the existing decision tools (verified in
`packages/mcp-sdk/src/index.ts` tool list + `apps/mcp/src/server.ts`
`TOOL_SCOPE`/`TOOL_CAPABILITY` maps and `register(...)`):

- Add `get_decision_analytics` to the tool-name list and its arg schema (optional
  `from`/`to`/`area`) in `packages/mcp-sdk/src/index.ts`.
- In `apps/mcp/src/server.ts`: `get_decision_analytics: 'decisions:read'` in the scope
  map, `get_decision_analytics: 'decisions'` in the capability map, and a `register`
  handler delegating to `decisionAnalyticsService.decisionSummary`.

Optionally a `record_decision_outcome` write tool later (an agent that ran a rollout
could log the result), gated `decisions:write`. Defer to a later slice; keep the MCP
surface minimal for the tracer.

## 8. Web UI

- **Decisions analytics view.** New `apps/web/src/app/(app)/decisions/analytics/page.tsx`
  (or a tab on the decisions index). Client component; fetch the `/analytics` summary via
  a new `api.getDecisionAnalytics(workspaceId, params)` in `apps/web/src/lib/api.ts`.
  Poll on the same `POLL_MS = 20_000` cadence as the dashboard so agent-made changes
  surface (matching the dashboard's rationale).
- **Charts.** New `apps/web/src/components/decision-charts.tsx`, mirroring
  `spend-charts.tsx`. Reuse `chart-theme.ts` exclusively (no hardcoded colors):
  - Status breakdown: horizontal `BarChart` (like `BreakdownChart`), one bar per status,
    `seriesColor` by slot.
  - Trend: `AreaChart` of decisions created vs decided per week (two series, slots 0/1).
  - Area distribution: `BarChart`.
- **Summary stat strip.** New `apps/web/src/components/decision-summary-cards.tsx`
  mirroring `usage-summary-cards.tsx`: cards for total decisions, median time-to-decision
  (days), decisions under review, and decision-quality mix. Use the en-dash `–` for any
  empty/no-value cell, exactly as `usage-summary-cards.tsx` does (`value ?? '–'`).
- **Aging list.** A card listing the oldest `under_review` decisions with age in days and
  a stale badge, linking to each decision.
- **Outcome-review surface (D2).** A "Reviews due" card (on the analytics view and/or the
  main dashboard, near the existing "needs review" banner) listing decisions past
  `review_at` with no recorded outcome, each with a record-outcome action. The record UI
  is a small form: a three-way choice (worked / mixed / did not work) plus an optional
  note, POSTing to `/:id/outcome`. Also add expected-outcome + review-date inputs to the
  decision accept flow (the decision detail/edit form).
- **Export button.** On the analytics view and/or decisions index: an "Export CSV" button
  that hits `GET /export` with the current area/quarter filter and triggers a download.
- **Main-dashboard rollup.** Extend the existing decisions `StatCard` in
  `apps/web/src/app/(app)/dashboard/page.tsx` with a time-to-decision hint, and surface
  the reviews-due count, reusing the current capability-aware, fail-open pattern.

## 9. Queue work (scheduled review-prompt sweep)

Mirror the handoff reaper exactly. In `packages/queue/src/index.ts`:

- Add a `HOUSEKEEPING_JOBS = { promptDecisionReviews: 'decision.prompt_reviews' }` const
  and a `HousekeepingJobData` type (the sweep carries no payload, like `HandoffReapJob`).
- Add `createHousekeepingQueue(connection)` (Queue over `QUEUE_NAMES.housekeeping`, which
  already exists in `QUEUE_NAMES`) and
  `scheduleDecisionReviewSweep(queue, everyMs = 60 * 60_000)` using `upsertJobScheduler`
  with a stable key (e.g. `decision-review-sweep`), exactly like `scheduleReaper`.

In `apps/worker/src/index.ts` + a new `apps/worker/src/decisions.ts` (mirroring
`handoffs.ts`):

- `runPromptDecisionReviews(db, env, logger)`: call
  `decisionAnalyticsService.decisionsDueForReview(db, new Date())`, and for each, email
  the Accountable via `sendEmail` + `renderBasicEmail` (subject and body per section 11),
  with a link to the decision's record-outcome surface. Mark prompts so the same review
  is not emailed every hour: either an `audit_events` `decision.review_prompted` marker
  checked before sending, or a `prompted_at` column. Prefer the audit marker (no schema
  change, and the trail is the intended record); the sweep skips a decision that already
  has a `decision.review_prompted` event for the current `review_at`.
- Register a housekeeping `Worker` alongside the sync/handoff workers and call
  `scheduleDecisionReviewSweep` at boot, following the existing boot pattern
  (`scheduleReaper`/`scheduleSubscriptionRenewal`). Hourly is enough for a review prompt.

Degrade gracefully: if mail is disabled (`sendEmail` returns `sent:false,
skippedReason:'no_api_key'`), the sweep still logs and the in-app "Reviews due" card is
the fallback prompt.

## 10. Capability gating and config

- Analytics, outcome review, and export all live inside the existing `decisions`
  capability. No new `CAPABILITY_KEYS` entry (verified list:
  `tasks, decisions, projects, context, objectives`). The API already fail-closes via
  `requireDecisionsAccess`; the analytics nav/tab uses the existing `CapabilityGate` /
  fail-open nav convention the dashboard uses.
- Config knobs (thresholds) start as constants, not env vars: the under-review "stale"
  threshold (e.g. 14 days) and the review-sweep cadence. If a customer needs per-workspace
  tuning later, a `config` JSONB on `workspace_capabilities` is the roadmap's stated
  extension point (roadmap section 4); do not build it for v1.
- The review-prompt email respects the same optional-mail posture as the rest of the
  platform (no key = logged no-op).

## 11. Copy considerations (all em-dash-free)

Strictly no em-dashes in any user-facing string (chart labels, card labels, export
headers, email copy, API errors). En-dash `–` only for empty/no-value cells, matching the
established convention in `usage-summary-cards.tsx`, `task-meta.ts`, `handoff-meta.ts`.

- **Outcome option labels** (reuse `DECISION_STATUS_LABELS` style in a new
  `DECISION_OUTCOME_LABELS` map in `apps/web/src/lib/decision-meta.ts`):
  `worked` → "Worked", `mixed` → "Mixed", `did_not_work` → "Did not work".
- **Chart labels:** "By status", "By area", "Decisions over time", "Created", "Decided",
  "Time to decision (days)", "Under review", "Aging in review".
- **Stat cards:** "Total decisions", "Median time to decision", "Under review", "Outcome
  quality". Empty cells render `–`.
- **Export headers (CSV):** `Title, Area, Status, Created, Decided, Days to decide,
  Accountable, Responsible, Consulted, Informed, Expected outcome, Outcome, Outcome note,
  Outcome recorded`. Plain words, no dashes.
- **Review-prompt email:** subject "Time to review a decision outcome"; body via
  `renderBasicEmail` heading "How did this decision turn out?", one body line naming the
  decision and its expected outcome, CTA "Record the outcome". No em-dashes; use commas
  and periods.
- **Empty states:** "No decisions in this period yet." "No reviews due right now."

## 12. Testing

- **Aggregation correctness:** seed decisions across statuses/areas/dates; assert
  `decisionSummary` status counts, area counts, and participation match hand-computed
  values. Include a null-area decision to confirm the coalesce/sentinel path.
- **Time-to-decision math:** seed decisions with known `created_at`/`decided_at` spans;
  assert median and average days. Cover: no decided decisions (return null/`–`, not
  NaN); a single decided decision; even vs odd counts for the median.
- **Aging:** seed `under_review` decisions with varied `updated_at`; assert ordering and
  the stale flag against the threshold. Note in the test the deliberate approximation:
  v1 ages by `updated_at`, which resets on any edit, so a decision edited while under
  review looks "younger" than it is. The precise measure is time since it *entered*
  `under_review`, derivable from `audit_events`; document this tradeoff and choose
  `updated_at` for v1 simplicity, `audit_events` if accuracy complaints arise.
- **Outcome review:** `recordOutcome` inserts a row and writes the audit event; a second
  review inserts a second row (proves the table-not-columns choice); `outcomeSummary`
  counts the latest outcome per decision; `decisionsDueForReview` returns only
  past-due decisions lacking an outcome and resolves the correct Accountable.
- **Export format:** assert CSV header order, correct quoting/escaping of commas and
  quotes in titles/notes, empty-cell rendering, and stakeholder grouping by role. A
  fixed-input golden CSV is the simplest assertion.
- **Sweep idempotency:** running the sweep twice within an hour prompts each due decision
  once (audit-marker guard).
- **D4 graceful degrade:** with no acknowledgements table/rows, the summary omits reach
  and the UI card is hidden; no error.

## 13. Ordered tracer-slice breakdown (S/M/L)

Thin, end-to-end, pausable slices (tracer-bullet principle). Each ships behind the
existing `decisions` capability.

1. **Slice 1 — basic status/area/time-to-decision dashboard card (S/M).** No outcomes.
   Add `decisionAnalyticsService.decisionSummary` (status counts, area counts, median +
   average time-to-decision), the `GET /analytics` endpoint, `api.getDecisionAnalytics`,
   the `decision-summary-cards.tsx` strip and a status/area `BarChart` from
   `decision-charts.tsx`, on a new analytics tab. Add the
   `(workspace_id, status, updated_at)` index. Pause for feedback: is this the reporting
   customers asked for?
2. **Slice 2 — aging + trend + participation (S).** Add the aging list, the
   created-vs-decided trend `AreaChart`, and the participation/no-Accountable stat. Pure
   additive read queries; no migration beyond slice 1.
3. **Slice 3 — outcome review data + record flow (M).** Migration: `expected_outcome_md`,
   `review_at` on `decisions`; `decision_outcomes` table + enum; `review_at` index.
   Add expected-outcome/review-date inputs at accept time, `POST /:id/outcome`,
   `recordOutcome`, the "Reviews due" card, and `outcomeSummary` on the analytics view.
   No scheduled prompt yet (manual review only).
4. **Slice 4 — scheduled review-prompt sweep (M).** Housekeeping queue job + worker +
   `scheduleDecisionReviewSweep` + Resend email + audit-marker idempotency. This is the
   retention hook.
5. **Slice 5 — register export (S/M).** `GET /export` CSV, `exportRegister`, export
   button, filename/quarter/area filters.
6. **Slice 6 — optional MCP analytics tool (S).** `get_decision_analytics`.
7. **Slice 7 — D4 rollout reach (M), after Theme C.** `reachSummary` + per-team card;
   guarded so it no-ops until Theme C tables exist.

## 14. Cross-theme dependencies and shared entities

- **`decisions` table (shared with A/B/C/E):** Theme A adds provenance, Theme B adds
  sign-off, Theme C reads `status` transitions. D's new columns (`expected_outcome_md`,
  `review_at`) and `decision_outcomes` table are additive and do not collide.
- **`audit_events` (shared platform trail):** D reads it for velocity/time-in-status and
  writes `decision.outcome_recorded` and `decision.review_prompted`. Keep action names
  namespaced `decision.*` like the existing service.
- **`decision_stakeholders` / RACI (shared with B):** D reads the Accountable to route
  review prompts and to compute participation. The single-Accountable rule is enforced in
  `updateDecision`; the sweep should handle a decision with no Accountable (skip and log,
  or fall back to the creator).
- **Notification layer (Theme B4 / C1):** D2's email is self-contained now via
  `packages/mail`; refactor to a shared notification service if Theme B/C ships one.
- **`decision_acknowledgements` / `decision_rollouts` (Theme C):** the only hard external
  dependency, for D4 only.
- **Objectives/key results (Theme E):** D's dashboard is the natural home for E3 strategy
  signals later; no coupling required now.
- **Capability system:** all of D lives under `decisions`; no new capability key.

## 15. Open questions and decisions for the user

1. **Live SQL vs snapshot table (recommendation: live SQL for v1).** For a small platform
   the aggregation queries are grouped counts and a couple of `avg`/`percentile` scans
   over one workspace's decisions, covered by the existing `(workspace_id, status)` index
   plus the new `(workspace_id, status, updated_at)` index. This is well within a single
   request budget and avoids a snapshot table, a snapshot sweep, and staleness. Recommend
   live SQL; revisit a periodic snapshot (built on the same housekeeping queue) only if a
   workspace's decision volume or dashboard traffic makes live aggregation slow. Confirm.
2. **Single review or recurring?** The data model (separate `decision_outcomes` table)
   supports recurring reviews, but v1 ships single-review UX (one `review_at`, prompt
   once). Do customers want scheduled re-reviews (30-day and 6-month)? If yes, add a
   review-schedule concept in a later slice; the table already accommodates it.
3. **Which decision-quality metrics matter to customers?** v1 offers the Cloverpop
   worked/mixed/did-not-work mix and a "reviewed vs overdue" rate. Is a single headline
   "decision quality score" wanted, or is the raw mix enough? This shapes the summary
   card copy.
4. **CSV vs richer export.** v1 is a single flat CSV. Is a quarterly board-ready report
   (grouped, formatted, possibly PDF) needed, or is CSV-into-a-spreadsheet sufficient for
   now? Richer export is a later slice if wanted.
5. **Aging basis: `updated_at` vs `audit_events` entered-review time.** v1 uses
   `updated_at` for simplicity, which is approximate (see section 12). Is entered-review
   accuracy important enough to compute from the audit trail in v1, or acceptable to defer?
6. **Where does the analytics view live?** A tab on the decisions index versus a dedicated
   `/decisions/analytics` route versus folding the top-line metrics into the main
   dashboard. Recommend a decisions-scoped analytics tab plus a small main-dashboard
   rollup; confirm the placement.
