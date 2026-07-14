# Theme C: Change management and enablement — implementation plan

> **Backlog tracked in Specboard.** This work is the **Theme C — Change Management** epic
> (release **Decisions: Change Management**) in the **Decisions Capability Expansion** initiative;
> its slices are the features C1, C2, C3, C4a, C4b, and C5. Specboard owns scope and status; this
> document is retained as build-time implementation reference. Reconciled 2026-07-14.

Status: proposal (2026-07-11). Parent: `docs/decisions-roadmap.md`, Theme C (goal 3).
Sequencing slot: roadmap slice 5, after the Theme B notification rails (slice 4).

**Resolved 2026-07-11 (open questions: delivery channels and audience granularity):**
v1 delivers both email and an in-app inbox (the in-app notifications table + `GET
/notifications` surface is part of the shared layer this plan defines, so acknowledgement
and rollout notices appear in-app as well as by email). Audience starts workspace-wide;
per-team and per-role targeting waits for a teams model. Acknowledgement is optional by
default (owner can require it per rollout) so slice 1 does not depend on mandatory-ack
enforcement.

## 1. Goal, roadmap goals served, and why this is the differentiator

**One-line goal:** when a cross-team decision is accepted, let its owner run a
targeted rollout: announce it, collect per-person acknowledgements, auto-remind,
escalate stragglers to the Accountable owner, propagate supersession as an event,
and spawn adoption tasks, all rolled up on the decision record.

**Roadmap goals served:** goal 3 (change management and enablement after
cross-team decisions). Feeds goal 4 (D4 rollout reach reporting reads Theme C
tables) and reinforces goal 5 (C3 supersession propagation reaches related
projects/objectives through `decision_relations`).

**Why this is the differentiator.** The market research in `docs/decisions-roadmap.md`
(section 1, "Post-decision change management is unoccupied ground") found three
mature ingredient categories (structured decision records; announce + per-person
ack + auto-remind; segment-targeted delivery with completion analytics) and **no
product that combines them on a decision record**. The only record-driven
acknowledgement loop found is ServiceNow GRC policy campaigns, confined to
compliance policies. ADR tools treat supersession as a passive status string.
**Nobody auto-escalates non-acknowledgers.** Theme C is the loop that closes
Palouse's positioning ("system of record for decisions… roll out, measure"):
a decision record that drives a targeted acknowledgement campaign with rollup on
the decision itself, with escalation and supersession-as-event on top. It has no
competitor as of mid-2026.

## 2. Prerequisites and dependencies

### 2a. Theme B reusable notification layer (HARD dependency, currently absent)

Theme B (B4 stakeholder notifications) is meant to build the reusable
"decision-event -> notification -> Resend email" rails Theme C rides on. **As of
2026-07-11 no Theme B plan exists** (`docs/plans/decisions-theme-b-ownership-input.md`
is absent) and no notification layer is implemented. Ground-truth findings:

- `packages/queue/src/index.ts` declares `QUEUE_NAMES.notifications` and
  `QUEUE_NAMES.housekeeping` **but neither has a queue-creator function or a
  worker**. Only `sync` and `handoff` queues are instantiated (`createSyncQueue`,
  `createHandoffQueue`) and consumed in `apps/worker/src/index.ts`. So the
  notification/housekeeping rails are name-only stubs.
- `packages/mail/src/index.ts` already has `sendEmail` (no-op + `console.warn`
  when `RESEND_API_KEY` unset; throws on Resend error; returns `{sent,id}`) and
  `renderBasicEmail({heading, bodyLines, ctaLabel?, ctaUrl?})`. This is the mail
  primitive; there is no decision-event-to-email mapping yet.

**Decision for this plan:** Theme C **defines the shared notification interface
itself** (section 5c below) rather than waiting on Theme B, and notes that Theme B
should adopt it when written. The interface is deliberately event-shaped so B's
"input requested" / "you are Accountable" / "decision finalized" events slot in
without rework. Concretely Theme C introduces:

- `createNotificationsQueue(connection)` + `NOTIFICATION_JOBS` in
  `packages/queue/src/index.ts`, modeled on `createHandoffQueue`.
- A `notificationService` in `packages/core/src/notifications/service.ts` exposing
  `dispatch(db, workspaceId, event)` where `event` is a discriminated union
  (`decision.rollout_announced`, `decision.ack_reminder`, `decision.escalation`,
  `decision.superseded`, and B's future events). It resolves recipients, writes
  in-app notification rows, and enqueues email jobs.
- A `notifications` worker branch in `apps/worker/src/index.ts` +
  `apps/worker/src/notifications.ts` (mirrors `apps/worker/src/handoffs.ts`).

If Theme B ships first, it owns queue + service + worker and Theme C only adds new
event variants. Either way the event union is the seam.

### 2b. Theme E relation resolution (SOFT dependency, needed for full C3)

C3 must notify "stakeholders of related projects/objectives". Today
`decision_relations.entityType` enum is `[task, project, project_item, goal,
context]` but only `task` is resolvable in the service (see the comment in
`packages/db/src/schema/decisions.ts`: "Only 'task' is resolvable today"). The
`goal` type is reserved but unwired; project relations exist in the enum but no
resolver walks them to stakeholders. **C3's "related projects/objectives" fan-out
depends on Theme E1/E2** wiring objective/project relations and a way to list an
objective's or project's stakeholders. Until Theme E lands, C3 degrades to
"notify everyone who acknowledged the original decision" (which needs no Theme E)
and skips the related-entity fan-out. Ship C3 in two steps accordingly.

### 2c. Teams / audience model (FUTURE, not in slice 1)

The roadmap says "workspace members now; teams when we have them." There is **no
teams table today**; membership is flat (`memberships` in
`packages/db/src/schema/identity.ts`, keyed by workspace + user, with
`role in [owner,admin,member,viewer]` and `status in [active,inactive]`).
`workspaces.listMembers(db, workspaceId)` returns the active roster. So the only
audience granularity available now is **workspace-wide (all active members)** with
an optional **explicit user list** and **RACI-role filter** (e.g. only Informed
stakeholders). The audience spec is stored as JSONB so a `team` audience kind can
be added later without a migration.

## 3. Refined sub-feature scope

- **C1 Rollout campaigns.** From an `accepted` decision, launch a rollout: pick an
  audience, write a short announcement (markdown), send in-app + email, create one
  `decision_acknowledgements` row per audience member, auto-remind on a cadence,
  and roll up reach (acked / total, %) on the decision detail. In scope for the
  theme; slice 1 ships the minimal workspace-wide announce + ack + rollup.
- **C2 Escalation.** After `escalate_after_reminders` reminders to a
  non-acknowledger, surface them to the decision's Accountable owner via in-app
  notification + a batched digest email. Deferred to slice 3.
- **C3 Supersession propagation.** When a decision moves to `superseded` or
  `deprecated`, emit a `decision.superseded` event that notifies (a) everyone who
  acknowledged the original, plus (b) stakeholders of related projects/objectives
  (Theme E dependent). Slice 4a does (a); slice 4b adds (b) once Theme E lands.
- **C4 Enablement tasks.** From a rollout, spawn follow-through tasks (per audience
  segment / per adoption step), each linked back to the decision via
  `decision_relations (entity_type='task')` so completion is visible on the
  decision. Reuses `taskService.createTask`. Slice 5.

Out of scope for Theme C: Simpplr-style rich announcement editor, read-time
analytics beyond ack, per-team segmentation (needs teams model), SMS/Slack
delivery channels (email + in-app only for v1).

## 4. Data model changes (drizzle sketches)

New schema file `packages/db/src/schema/rollouts.ts` (keeps decisions.ts focused;
exported from the schema barrel like the other areas). Two new enums plus two
tables for C1/C2, and one generic in-app notification table for the shared layer.
Follow existing conventions: `baseId()` = `uuid` PK `gen_random_uuid()`;
`ts(name)` = `timestamptz` `mode:'date'` notNull defaultNow; snake_case columns.

> Migration number is assigned at implementation time via `drizzle-kit generate`.
> The current max is `0018_webhook-hardening.sql`; **do not hardcode a number**,
> let the generator pick the next (`packages/db/migrations/NNNN_<name>.sql`).

```ts
// packages/db/src/schema/rollouts.ts
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { decisions } from './decisions.js';
import { users, workspaces } from './identity.js';

const baseId = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const rolloutStatus = pgEnum('rollout_status', [
  'active',     // announced, collecting acks / reminding
  'completed',  // all acknowledged, or owner marked done
  'cancelled',
]);

export const reminderCadence = pgEnum('reminder_cadence', [
  'none',    // announce once, never remind
  'daily',   // debug/aggressive
  'every_3_days', // Guru norm — default
  'weekly',  // Simpplr norm
]);

// medium the ack request reached the person through, for reporting.
export const ackMedium = pgEnum('ack_medium', ['in_app', 'email', 'both']);

export const decisionRollouts = pgTable(
  'decision_rollouts',
  {
    id: baseId(),
    // Denormalized workspaceId so audience/reporting queries and capability
    // checks never need to join through decisions.
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id').notNull().references(() => decisions.id, { onDelete: 'cascade' }),
    initiatedByUserId: uuid('initiated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    // Audience spec is JSONB so we can add 'team' membership later with no migration.
    // { kind: 'workspace' } | { kind: 'users', userIds: string[] } | { kind: 'raci_role', roles: RaciRole[] }
    audience: jsonb('audience').notNull(),
    messageMd: text('message_md').notNull(),
    status: rolloutStatus('status').notNull().default('active'),
    reminderCadence: reminderCadence('reminder_cadence').notNull().default('every_3_days'),
    escalateAfterReminders: integer('escalate_after_reminders').notNull().default(2),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    decisionIdx: index('decision_rollouts_decision_idx').on(t.decisionId),
    workspaceStatusIdx: index('decision_rollouts_workspace_status_idx').on(t.workspaceId, t.status),
  }),
);

export const decisionAcknowledgements = pgTable(
  'decision_acknowledgements',
  {
    id: baseId(),
    rolloutId: uuid('rollout_id').notNull().references(() => decisionRollouts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, mode: 'date' }), // nullable = outstanding
    remindedCount: integer('reminded_count').notNull().default(0),
    lastRemindedAt: timestamp('last_reminded_at', { withTimezone: true, mode: 'date' }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true, mode: 'date' }), // C2: set once surfaced to Accountable
    medium: ackMedium('medium').notNull().default('both'),
    createdAt: ts('created_at'),
  },
  (t) => ({
    // One ack row per (rollout, user); underpins idempotent acknowledge + reach rollup.
    rolloutUserUq: uniqueIndex('decision_acks_rollout_user_uq').on(t.rolloutId, t.userId),
    // Sweep queries filter on outstanding rows; partial index keeps the reminder sweep cheap.
    outstandingIdx: index('decision_acks_outstanding_idx').on(t.rolloutId, t.acknowledgedAt),
  }),
);
```

Shared in-app notification table (part of the notification layer Theme C
introduces; Theme B reuses it). Kept generic, not decision-specific:

```ts
// packages/db/src/schema/notifications.ts
export const notifications = pgTable(
  'notifications',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // e.g. 'decision.rollout_announced', 'decision.escalation', 'decision.superseded'
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    bodyMd: text('body_md'),
    // Deep-link target: { type: 'decision', id } so the web inbox can route.
    target: jsonb('target'),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    createdAt: ts('created_at'),
  },
  (t) => ({
    userUnreadIdx: index('notifications_user_unread_idx').on(t.userId, t.readAt),
    workspaceIdx: index('notifications_workspace_idx').on(t.workspaceId),
  }),
);
```

Note: no change to `decisions` is required. `decisions.supersededByDecisionId`
already exists (`onDelete: 'set null'`), and `decision_relations` with
`entity_type='task'` already carries C4's task links. `audit_events` continues to
capture provenance (rollout launched, acknowledged, superseded event) via the
existing `audit()` helper pattern.

## 5. Core service layer

### 5a. `rolloutService` (`packages/core/src/rollouts/service.ts`)

Exported from `@palouse/core` alongside `decisionService`. Standard signature
`(db, workspaceId, actor, ...)`; writes `audit_events`.

- `launchRollout(db, workspaceId, actor, decisionId, input)`
  - Loads the decision (must exist in workspace); **guards `status === 'accepted'`**
    (throw `validation` otherwise). Rollouts only launch on accepted decisions.
  - Resolves the audience spec to a user-id set:
    - `workspace` -> `workspaces.listMembers(db, workspaceId)` filtered to
      `status === 'active'`.
    - `users` -> the explicit list, intersected with active members (drop
      non-members defensively).
    - `raci_role` -> `decision_stakeholders` for this decision filtered to the
      given roles, intersected with active members.
  - In a transaction: insert `decision_rollouts` row, then bulk-insert one
    `decision_acknowledgements` per resolved user (`onConflictDoNothing` on the
    `(rollout,user)` unique index for safety).
  - Emits a `decision.rollout_announced` notification event (see 5c) to the
    audience, then audits `decision.rollout_launched`.
  - Returns the rollout DTO with an initial reach rollup (0 acked / N total).
- `acknowledge(db, workspaceId, actor, rolloutId)`
  - Actor must be a `user` (agents do not acknowledge on a person's behalf; reject
    agent actors with `validation`).
  - **Idempotent:** `update decision_acknowledgements set acknowledged_at = now()
    where rollout_id = ? and user_id = ? and acknowledged_at is null`. A second
    call is a no-op (0 rows, still 200). If no ack row exists for this user (they
    were not in the audience) throw `notFound`.
  - After ack, if the rollout has zero outstanding rows, flip status to
    `completed`. Audit `decision.acknowledged`.
- `getRolloutStatus(db, workspaceId, rolloutId)` — returns the rollout plus reach
  rollup: `{ total, acknowledged, outstanding, escalated, byUser: [{userId, name,
  email, acknowledgedAt, remindedCount}] }`. Backs the API + MCP status calls and
  the web Rollout section.
- `listRolloutsForDecision(db, workspaceId, decisionId)` — 0..n rollouts (a
  decision can be re-rolled out, e.g. after amendment), each with rollup counts
  (grouped-count pattern already used in `listDecisions`).
- `cancelRollout(db, workspaceId, actor, rolloutId)` — sets status `cancelled`,
  stops future reminders (the sweep skips non-`active` rollouts). Audit.

### 5b. Hooking the decision transitions

Two hooks fire from `decisionService.updateDecision` (in
`packages/core/src/decisions/service.ts`), which already special-cases the
`accepted` transition (single-Accountable guard, `decidedAt` stamping):

1. **Accepted transition (C1 trigger).** We do **not** auto-launch a rollout
   (rollouts are opt-in per the roadmap: "optionally launch a rollout"). Instead,
   on the `-> accepted` transition emit an in-app-only `decision.accepted` hint to
   the Accountable owner ("This decision is accepted. Launch a rollout to announce
   it?") deep-linking to the decision. Launch stays an explicit user action.
2. **Superseded / deprecated transition (C3 trigger).** When `input.status`
   transitions to `superseded` or `deprecated` (and the prior status was neither),
   call `notificationService.dispatch` with a `decision.superseded` event. This is
   the "supersession as an event, not a status string" behavior. Recipient
   resolution lives in `rolloutService.resolveSupersessionAudience`:
   - Everyone with an `acknowledged_at`-non-null ack across any rollout of this
     decision (they were told about it; they must be told it changed).
   - Plus (Theme E dependent) stakeholders of related projects/objectives resolved
     from `decision_relations`. Guard behind a capability/feature check; skip
     cleanly if the resolver is not yet available.

   Include a link to `supersededByDecisionId` when set, so the notification says
   "superseded by <new decision>".

Keep these hooks thin: `updateDecision` computes the transition and calls the
notification/rollout service; it must not fail the status update if dispatch
throws (wrap dispatch so a mail/queue outage does not roll back the decision
change; log and continue, mirroring how mail is treated as optional).

### 5c. Shared notification interface (`packages/core/src/notifications/service.ts`)

```ts
export type NotificationEvent =
  | { type: 'decision.rollout_announced'; workspaceId: string; decisionId: string; rolloutId: string; recipientUserIds: string[]; messageMd: string }
  | { type: 'decision.ack_reminder'; workspaceId: string; decisionId: string; rolloutId: string; recipientUserId: string }
  | { type: 'decision.escalation'; workspaceId: string; decisionId: string; rolloutId: string; accountableUserId: string; laggards: { userId: string; remindedCount: number }[] }
  | { type: 'decision.superseded'; workspaceId: string; decisionId: string; supersededByDecisionId: string | null; recipientUserIds: string[] }
  // Theme B slots its events in here later:
  // | { type: 'decision.input_requested'; ... }
  // | { type: 'decision.finalized'; ... }
  ;

// dispatch(): for each recipient, insert a `notifications` row (in-app) and
// enqueue a `notifications` queue job to render + send the Resend email.
// Idempotency: email jobs use a deterministic jobId per (event, recipient, day).
export async function dispatch(db: Database, event: NotificationEvent): Promise<void>;
```

The email rendering (subjects/bodies, section 11) lives in the notifications
worker, using `renderBasicEmail` + `sendEmail` from `@palouse/mail`.

## 6. API routes (`apps/api/src/routes/decisions.ts`, or a sibling `rollouts.ts`)

Mount under the existing decisions router so `requireDecisionsAccess`
(membership + `decisions` capability) is reused. All routes take `workspaceId`
(query for GET/DELETE, body for POST) exactly like the existing decision routes.

- `POST /decisions/:id/rollouts` — launch a rollout. Body:
  `{ workspaceId, audience, messageMd, reminderCadence?, escalateAfterReminders? }`.
  Zod: `launchRolloutInput` in `packages/shared/src/decision.ts`. Returns
  `{ rollout }` 201.
- `GET /decisions/:id/rollouts` — list rollouts for the decision with rollups.
- `GET /rollouts/:rolloutId` — full status (`getRolloutStatus`), incl. per-user ack
  table. `workspaceId` query param.
- `POST /rollouts/:rolloutId/acknowledge` — the current user acknowledges. Body
  `{ workspaceId }`. Idempotent; returns `{ acknowledged: true, rollout }`.
- `POST /rollouts/:rolloutId/cancel` — owner/admin cancels.
- `POST /rollouts/:rolloutId/tasks` — C4: spawn enablement tasks. Body
  `{ workspaceId, tasks: [{ title, descriptionMd?, assigneeUserId? }] }`. Creates
  each via `taskService.createTask` then `decisionService.addRelation` with
  `entityType='task'`. Returns created tasks. (Slice 5.)

Add `notifications` inbox routes for the in-app surface:
- `GET /notifications?workspaceId=` — current user's unread + recent.
- `POST /notifications/:id/read` — mark read.
- `POST /notifications/read-all?workspaceId=`.

Authorization note: acknowledge/list must confirm the acting user is in the
rollout audience (has an ack row) or is a workspace admin/owner; launching/cancel
should require the decision's Accountable owner or an admin (reuse
`workspaces.requireRole` where a role gate is wanted).

## 7. MCP tools (minimal)

Agents rarely drive rollouts; keep the surface read-only plus one optional launch.
In `packages/mcp-sdk/src/index.ts` (tool-name list + zod shapes + descriptions)
and `apps/mcp/src/server.ts` (SCOPES + CAPABILITY + register blocks):

- `get_rollout_status` (scope `decisions:read`) — returns reach rollup for a
  rollout id, so an agent asked "did everyone acknowledge the pricing decision?"
  can answer. **Ship this.**
- `list_decision_rollouts` (scope `decisions:read`) — optional, lists rollouts for
  a decision. Ship if cheap.
- Do **not** add an agent `acknowledge` tool (acks are personal, human acts of
  attestation). Optionally add `launch_rollout` (scope `decisions:write`) later if
  an agent-driven "announce this decision" flow is requested; defer for v1.

Scopes already cover this: `decisions:read` / `decisions:write` exist in
`packages/shared/src/agent.ts`, and wildcard `*` keys inherit new tools
automatically (pre-existing granular keys need one re-mint, per the decisions-
capability memory note).

## 8. Web UI (`apps/web`)

- **Rollout section in `decision-detail-sheet.tsx`.** The sheet is section-based
  (h3 headers: RACI, Related, Supporting resources, Discussion), not tabbed. Add a
  **"Rollout"** section, shown only when `decision.status === 'accepted'` (or when a
  rollout already exists). It shows:
  - If no rollout: a "Launch rollout" button (opens the launch dialog).
  - If a rollout exists: the **reach rollup** (`acked / total`, a percentage bar
    reusing the Fieldwork progress token that "grows toward green"), plus a
    per-person ack list (name, acknowledged timestamp or an en-dash `–` placeholder
    for outstanding, reminded count). Cancel button for owner/admin.
- **Launch-rollout dialog.** Audience picker (v1: "All workspace members" default;
  "Specific people" multi-select from `listMembers`; "By RACI role" checkboxes),
  a markdown message field (prefilled with the decision title + a template line),
  a reminder-cadence select (default "Every 3 days"), and an "escalate after N
  reminders" number (default 2). Reuse the multi-select pattern from the
  team-management bulk hand-off work.
- **In-app "please acknowledge" surface.** A notifications inbox (bell icon in the
  app header) driven by the `notifications` routes: unread count badge, a dropdown
  listing items, each deep-linking to the decision. A `decision.rollout_announced`
  item renders an inline "Acknowledge" button that calls the acknowledge route and
  removes itself on success.
- **Refresh pattern.** Add a `palouse:rollouts-changed` window event mirroring
  `HANDOFFS_CHANGED_EVENT` (`apps/web/src/lib/handoff-meta.ts`); dispatch it after
  launch/acknowledge/cancel so the detail sheet and inbox re-fetch. Add
  `api.launchRollout`, `api.getRolloutStatus`, `api.acknowledgeRollout`,
  `api.listNotifications`, `api.markNotificationRead` to
  `apps/web/src/lib/api.ts`. Add rollup/label helpers to
  `apps/web/src/lib/decision-meta.ts`.

## 9. Queue and mail work

Model everything on the existing repeatable-sweep precedent
(`scheduleReaper` -> `handoff.reap_expired` -> `runReapExpired`, a 30s
`upsertJobScheduler` sweep in `packages/queue/src/index.ts` +
`apps/worker/src/handoffs.ts`).

- **Notifications queue.** Add `createNotificationsQueue(connection)` +
  `NOTIFICATION_JOBS = { sendEmail: 'notification.send_email' }` and a
  `NotificationEmailJob` payload type in `packages/queue/src/index.ts`. Instantiate
  it in `apps/worker/src/index.ts` with a `notifications` `Worker` and an
  `apps/worker/src/notifications.ts` handler that renders + `sendEmail`s. Dedupe
  with a deterministic `jobId` per `(rolloutId, userId, kind, dayBucket)` so a
  reminder is never double-sent within a day even if the sweep overlaps.
- **Announcement send.** `dispatch(decision.rollout_announced)` enqueues one email
  job per recipient (plus writes the in-app rows synchronously).
- **Scheduled reminder sweep.** Add
  `scheduleRolloutReminders(queue, everyMs = 15 * 60_000)` ->
  `ROLLOUT_JOBS.remindSweep` on either the `notifications` or a new `rollouts`
  queue, scheduled at worker boot next to `scheduleReaper`. The sweep
  (`runRolloutReminderSweep`) selects `active` rollouts whose outstanding ack rows
  are due per `reminder_cadence` (`last_reminded_at` older than the cadence
  interval, or null and rollout older than the interval), then for each due ack:
  increments `reminded_count`, sets `last_reminded_at`, and dispatches
  `decision.ack_reminder`. Cadence-to-interval map: `none` -> never;
  `daily` -> 24h; `every_3_days` -> 72h; `weekly` -> 168h. The sweep runs every
  ~15 min; cadence is enforced by the per-ack `last_reminded_at` check, so the
  sweep interval and the cadence are independent (same design as the reaper).
- **Escalation digest (C2).** In the same sweep, any outstanding ack whose
  `reminded_count >= rollout.escalate_after_reminders` and `escalated_at is null`
  is collected per rollout; dispatch one `decision.escalation` event per rollout to
  the decision's Accountable owner (batched: one digest listing all laggards, not
  one email per laggard), then stamp `escalated_at` so it escalates once.
- **Mail.** All emails via `sendEmail` + `renderBasicEmail` from `@palouse/mail`
  (already no-op-safe without `RESEND_API_KEY`, logs on skip). CTA URL deep-links
  to the decision or the acknowledge action.

## 10. Capability gating and config

- Gate the whole theme behind the existing **`decisions`** capability. The API
  routes already run `requireDecisionsAccess` (membership + `decisions` cap). No
  new top-level `CAPABILITY_KEYS` entry is needed for v1 (keeping the enum at
  `[tasks, decisions, projects, context, objectives]`).
- If finer control is wanted later, follow the roadmap's stated option: a config
  JSONB on `workspace_capabilities` (e.g. `decisions.rolloutsEnabled`) rather than
  a new top-level key. Note in the plan, do not build for v1.
- Config knobs (env or workspace config, not hardcoded): default reminder cadence,
  default `escalate_after_reminders`, the sweep interval, and a per-workspace
  toggle to disable auto-reminders entirely (`reminder_cadence = 'none'`).
- MCP tool gating: `get_rollout_status` sits under the decisions CAPABILITY block
  in `apps/mcp/src/server.ts`, consistent with existing decision tools.

## 11. Copy considerations (em-dash-free, per CLAUDE.md)

All user-facing strings (emails, in-app notifications, dialog copy) MUST avoid the
em-dash `—`. Use a period, comma, colon, semicolon, or parentheses. The en-dash
`–` is only for empty-value placeholders (an unacknowledged person's timestamp
cell). Example subject lines and bodies (all em-dash-free):

- **Announcement email** subject: `Action needed: acknowledge the "<title>" decision`.
  Body line: `A decision was finalized in <workspace>. Please review it and
  acknowledge that you have seen it.` CTA: `Review and acknowledge`.
- **Reminder email** subject: `Reminder: please acknowledge "<title>"`.
  Body: `You have not yet acknowledged this decision. It takes one click.`
- **Escalation digest** (to Accountable) subject:
  `<N> people have not acknowledged "<title>"`. Body: `As the accountable owner,
  here are the people who still need to acknowledge this rollout:` followed by a
  list. CTA: `Open the rollout`.
- **Supersession email** subject: `Update: the "<title>" decision has changed`.
  Body: `A decision you acknowledged has been <superseded|deprecated>.` When
  `supersededByDecisionId` is set, add: `It is replaced by "<new title>".`
- **In-app announced**: `Please acknowledge the "<title>" decision.`
- **In-app accepted hint** (to owner): `This decision is accepted. Launch a rollout
  to announce it to your team.`

Reach rollup label: `12 of 18 acknowledged (67%)`. Outstanding cell: en-dash `–`.

## 12. Testing

- **Ack idempotency**: acknowledging twice yields one `acknowledged_at`, second
  call is a no-op 200; acking a rollout you are not in the audience of -> 404.
- **Audience resolution**: `workspace` excludes `inactive` members; `users` drops
  non-members; `raci_role` maps to the right stakeholders; empty audience is
  rejected with `validation`.
- **Launch guard**: launching on a non-`accepted` decision throws `validation`.
- **Reminder scheduling**: with cadence `every_3_days`, an ack with
  `last_reminded_at` 72h+ ago is due; one 1h ago is not; `none` never reminds;
  `reminded_count` and `last_reminded_at` advance exactly once per sweep pass
  (use fake timers, as the handoff reaper tests do).
- **Escalation once**: after `escalate_after_reminders` reminders, exactly one
  `decision.escalation` dispatch per rollout; `escalated_at` prevents re-escalation.
- **Supersession event**: moving `accepted -> superseded` dispatches
  `decision.superseded` to all acknowledgers and includes the successor link;
  moving between non-terminal statuses does not.
- **Reach rollup**: counts match ack rows; completing all acks flips rollout to
  `completed`.
- **Dispatch isolation**: a thrown `sendEmail`/queue error does not roll back the
  decision status update (mail is optional infrastructure).
- **C4**: spawned tasks are created and each gets a `decision_relations`
  `entity_type='task'` row visible from the decision.

## 13. Ordered tracer-slice breakdown (within Theme C)

Each slice is thin end-to-end and pausable for feedback (per the tracer-bullet
build principle). Effort: S = ~1-2 days, M = ~3-5 days, L = ~1-2 weeks.

1. **Slice 1 — minimal announce + ack + rollup (workspace-wide only). [M]**
   Notification queue/service/worker seam (2a) with just the two events it needs;
   `decision_rollouts` + `decision_acknowledgements` + `notifications` tables;
   `launchRollout` (workspace audience only) + `acknowledge` +
   `getRolloutStatus`; launch dialog (audience fixed to "all members"),
   in-app announce notification with inline Acknowledge, reach rollup on the
   detail sheet; announcement email. **No reminders, no escalation, no teams.**
2. **Slice 2 — audience granularity + auto-reminders. [M]** Add `users` and
   `raci_role` audience kinds to the dialog + resolver; the repeatable reminder
   sweep + reminder email; per-person reminded-count in the rollup.
3. **Slice 3 — escalation (C2). [S]** Escalation collection in the sweep +
   digest email + in-app escalation to the Accountable owner; `escalated_at`.
4. **Slice 4a — supersession event to acknowledgers (C3, no Theme E). [S]**
   Hook `superseded`/`deprecated` transitions; `decision.superseded` to everyone
   who acknowledged; successor link.
   **Slice 4b — related project/objective fan-out (C3, Theme E dependent). [S]**
   Ships after Theme E1/E2; extends `resolveSupersessionAudience`.
5. **Slice 5 — enablement tasks (C4). [S]** `POST /rollouts/:id/tasks` reusing
   `taskService.createTask` + `decisionService.addRelation('task')`; a
   "Spawn adoption tasks" action in the Rollout section; completion visible via
   the existing Related section.
6. **Slice 6 — MCP `get_rollout_status` (+ optional `list_decision_rollouts`). [S]**

## 14. Cross-theme dependencies and shared entities

- **Theme B** owns (or should adopt) the notification queue/service/worker seam
  Theme C introduces here (2a, 5c). If B ships first, C only adds event variants.
  If C ships first (likely, since it is roadmap slice 5 vs B slice 4 but B may
  slip), C owns the seam and B extends it. Either way the `NotificationEvent`
  union is the contract.
- **Theme E** (E1/E2) unlocks C3's related-project/objective fan-out (2b). C3
  ships in two steps so it is not blocked on E.
- **Theme D** (D4 rollout reach reporting) reads `decision_rollouts` /
  `decision_acknowledgements` directly. Design those tables (done above) with the
  reporting query in mind (denormalized `workspaceId`, status index).
- **Shared entities:** `decision_relations` (`entity_type='task'`) for C4 links;
  `decisions.supersededByDecisionId` for C3 successor linkage; `workspaces.listMembers`
  and `memberships` for audience; `taskService.createTask` for C4; `audit_events`
  for provenance; `@palouse/mail` for all email; the new `notifications` table is
  shared with Theme B.
- **Future teams model** plugs into the JSONB audience spec (`{ kind: 'team' }`)
  with no migration to the rollout tables.

## 15. Open questions / decisions the user needs to make

1. **Is acknowledgement mandatory or optional?** For v1 acknowledgement is a
   *nudge* (you can ignore reminders; escalation surfaces you but does not block
   anything). Do we ever want a "required read" mode that, e.g., blocks a related
   task or shows a persistent banner until acknowledged? Recommendation: optional
   for v1; revisit a compliance-grade "required" mode when a customer asks.
2. **Audience granularity for slice 1.** Given no teams model, slice 1 ships
   workspace-wide only, slice 2 adds explicit users + RACI-role. Confirm that is
   acceptable, or do we need explicit-user selection in slice 1?
3. **In-app inbox vs email-only for v1.** This plan builds both (in-app
   notifications table + inbox, plus email). If we want to cut scope, email-only is
   simpler but weaker for the "please acknowledge" loop (email deep-link to
   acknowledge still works). Recommendation: ship both; the in-app inbox is the
   reusable surface Theme B also needs.
4. **Auto-launch vs opt-in.** This plan keeps rollout launch an explicit user
   action (roadmap says "optionally launch"), with an in-app hint on acceptance.
   Confirm we do not want auto-launch on accept.
5. **Default reminder cadence.** Recommendation: `every_3_days` (Guru norm) with
   `escalate_after_reminders = 2`. Confirm, or prefer `weekly` (Simpplr norm).
6. **Who can launch/cancel a rollout?** Recommendation: the decision's Accountable
   owner or a workspace admin/owner. Confirm the role gate.
7. **Re-rollout semantics.** A decision may have multiple rollouts (e.g. after an
   amendment). Is that desired, or should launching a second rollout supersede the
   first? This plan allows multiple; the rollup shows the latest by default.
8. **Notification layer ownership.** Confirm Theme C owns the shared notification
   seam given no Theme B plan exists yet, so Theme B adopts it rather than the
   reverse.
