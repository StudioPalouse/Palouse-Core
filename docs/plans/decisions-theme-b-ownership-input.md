# Theme B implementation plan: Ownership and stakeholder input

> **Backlog tracked in Specboard.** This work is the **Theme B — Ownership & Input** epic
> (release **Decisions: Ownership & Input**) in the **Decisions Capability Expansion** initiative;
> its slices are the features B2 (sign-off), B4 (notification rails), B1 (input rounds), and B3
> (templates). Specboard owns scope and status; this document is retained as build-time
> implementation reference. Reconciled 2026-07-14.

Status: plan (2026-07-11). Parent: `docs/decisions-roadmap.md` (Theme B, goal 2).
Verified against the codebase on 2026-07-11.

**Resolved 2026-07-11 (open question: does a `block` stance hard-block acceptance?):**
advisory by default. A `block` stance flags the decision but does not prevent the
Accountable owner from signing off. Hard-blocking is opt-in per decision process template
(B3): a template may declare which stances block, so a consent or consensus template can
require that no unresolved `block` exists before `accepted`. Build the advisory path in
B1; wire template-driven blocking when B3 lands.

## 1. Title, goal, and roadmap goals served

**Theme B: Ownership and stakeholder input.**

One-line goal: make a decision's ownership explicit and let the people around it
register structured, on-the-record input before it is finalized.

Roadmap goal served: goal 2, "Track decision ownership and stakeholder input."
This theme also builds the notification rails that Theme C (change management and
enablement) depends on, so a slice of it is deliberately over-built for reuse.

Sub-features:

- **B1. Input rounds.** The Loomio stance pattern layered on the existing RACI model.
  Request stances (agree / concerns / block / abstain) with a required rationale and a
  deadline; surface stance counts and unanswered requests on the decision.
- **B2. Accountable sign-off.** An explicit approval step gating `under_review` to
  `accepted`/`rejected`, reusing the handoff state-machine discipline.
- **B3. Decision process templates.** Per-workspace reusable governance templates
  (advice, consent, consensus, DACI) that pre-fill roles, input rounds, and required
  fields at decision creation.
- **B4. Stakeholder notifications.** Queue jobs plus Resend emails driven by decision
  events, designed as a reusable decision-event to notification mapping.

## 2. Prerequisites and dependencies on other themes

- **No hard dependency on Theme A.** Theme B works on decisions created by hand or by
  agents today. Theme A (capture) increases the volume of decisions but is not required.
- **Theme C depends on Theme B's B4 layer.** The notification/enqueue layer built in B4
  is the foundation for C1 rollout announcements, C2 escalation, and C3 supersession
  propagation. Design it once, here, for reuse (see section 9).
- **Existing groundwork already in place (verified):**
  - `decisionService` (`packages/core/src/decisions/service.ts`) enforces the
    single-Accountable rule in two places: `assertSingleAccountable()` on create and on
    `setStakeholders`, and a stricter "exactly one Accountable" check inside
    `updateDecision` when moving to `accepted` (lines 289-304). It also stamps
    `decidedAt` the first time status reaches `accepted` or `rejected` (lines 306-311).
    B2 layers on top of this, it does not replace it.
  - `decision_status` enum already has `under_review` between `proposed` and
    `accepted`/`rejected`, so the sign-off gate has a natural home.
  - Audit trail via `auditEvents` is written by every decision mutation through the
    local `audit()` helper (service.ts lines 481-498), `target_type = 'decision'`.
  - Capability gating for decisions is live end-to-end: API `requireDecisionsAccess`
    (`apps/api/src/routes/decisions.ts` lines 24-33) and MCP `CAPABILITY`/`isAvailable`
    (`apps/mcp/src/server.ts` lines 66-117).
  - The `notifications` queue name is declared (`packages/queue/src/index.ts` line 7)
    but has no queue factory, producer, or consumer yet. B4 builds all three.
  - Mail path is `sendEmail` + `renderBasicEmail` (`packages/mail/src/index.ts`), a
    no-op that logs a warning when `RESEND_API_KEY` is unset. `WEB_BASE_URL` is in
    config for building links (`packages/config/src/index.ts` line 41).

## 3. Refined sub-feature scope

### B1. Input rounds

A round is a time-boxed request for stances, opened by a user (typically the
Accountable or a Responsible owner) against a decision. Each targeted stakeholder can
submit exactly one stance with a required rationale. The round is `open` until its
deadline passes or the opener closes it. Scope for slice:

- Round targets are drawn from the decision's existing RACI roster, defaulting to
  `consulted` and `informed` roles (per the roadmap), but the opener may include any
  workspace member. Store the target set explicitly so "unanswered" is computable.
- Stance enum: `agree`, `concerns`, `block`, `abstain`. Rationale required for all four
  (a `block` with no reason is useless; a bare `agree` is fine but we still require a
  short note for the record, matching Loomio's per-voter reasoning).
- One stance per (round, user); resubmission overwrites (upsert) so people can change
  their mind while the round is open.
- Surface on the decision detail: per-stance counts, who has not answered yet, and any
  `block` prominently.
- Out of scope for the first slice: multiple poll types, weighted votes, anonymous
  input, threaded replies to a stance (a decision comment covers discussion).

### B2. Accountable sign-off

Recommendation: **sign-off is not a new status and not a new table. It is an explicit
service action, `signOffDecision`, that performs the guarded `under_review` to
`accepted`/`rejected` transition and records who signed off.** Rationale:

- `decision_status` already models the outcome; adding an `awaiting_signoff` status
  would ripple through every enum consumer (shared zod, MCP descriptions, web labels,
  status-order arrays) for little gain.
- The single-Accountable rule and `decidedAt` stamping already live in `updateDecision`.
  A dedicated action lets us (a) require the actor to *be* the Accountable stakeholder,
  (b) require the current status to be `under_review` (so acceptance cannot skip
  review), and (c) record the sign-off actor and timestamp as new columns on
  `decisions`.
- We keep `updateDecision`'s existing status path for administrative corrections, but
  gate the *forward* `under_review` to `accepted`/`rejected` move behind sign-off (see
  section 5 for exactly how the two interact).

New columns on `decisions`: `signed_off_by_user_id`, `signed_off_at`. Sign-off writes a
`decision.signed_off` audit action and emits a `decision.finalized` notification event.

The handoff state machine (`packages/core/src/handoffs/state-machine.ts`) is the
template for *how* to write a guarded transition: a single conditional UPDATE whose
`WHERE` clause encodes the from-state (`state = 'needs_review'` there; `status =
'under_review'` here), returning zero rows to signal a `conflict` when the guard fails,
followed by an event row and an audit row. We reuse that discipline, not its tables.

### B3. Decision process templates

Per-workspace named templates encoding a governance model. A template pre-fills, at
decision-create time:

- a default RACI roster shape (roles to assign, left for the creator to fill with
  people, or optionally pre-bound users),
- one or more required input rounds to open,
- required fields (e.g. description, area, an expected-outcome note) the creator must
  supply,
- a governance `kind` label: `advice`, `consent`, `consensus`, `daci`, or `custom`.

Scope: templates are data-driven config, not code. Store the shape as JSONB so we can
evolve the encoded governance without a migration each time. Seed a workspace with the
four canonical templates on first use (lazy, not a data migration). Applying a template
is a create-time convenience: it produces a normal decision plus normal rounds, so
nothing downstream needs to know a template was used.

### B4. Stakeholder notifications

A reusable decision-event to notification layer:

1. Decision service methods emit typed **decision events** (not raw emails).
2. A mapping turns each event into zero or more **notification jobs** (one per
   recipient), enqueued on the `notifications` queue.
3. A worker consumer resolves recipient emails, renders with `renderBasicEmail`, sends
   via `sendEmail`, and **logs on send** (the staging gotcha: `sendEmail` no-ops
   silently when `RESEND_API_KEY` is unset, so the worker must log intent and outcome).

Initial events: `accountable_assigned` ("you are now Accountable"),
`input_requested` ("your input is requested"), `decision_finalized` ("decision
finalized"). Theme C later adds `rollout_announced`, `supersession`, etc. to the same
mapping.

## 4. Data model changes (by content, with drizzle sketches)

New tables live in `packages/db/src/schema/decisions.ts` alongside the existing decision
tables. Migration files are `packages/db/migrations/NNNN_<name>.sql`; **migration numbers
are assigned at implementation time (current max is 0018), do not hardcode.** Conventions
match the file: `gen_random_uuid()` PKs via the local `baseId()` helper, `ts()` for
`timestamptz` `mode: 'date'` `notNull().defaultNow()`, snake_case columns, `onDelete`
cascade to the parent decision.

### New enums

```ts
export const inputStance = pgEnum('decision_input_stance', [
  'agree',
  'concerns',
  'block',
  'abstain',
]);

export const inputRoundStatus = pgEnum('decision_input_round_status', ['open', 'closed']);

export const decisionTemplateKind = pgEnum('decision_template_kind', [
  'advice',
  'consent',
  'consensus',
  'daci',
  'custom',
]);
```

Mirror each in `packages/shared/src/decision.ts` as a `z.enum` with the "keep in sync"
comment already used there.

### B1: input rounds and inputs

```ts
export const decisionInputRounds = pgTable(
  'decision_input_rounds',
  {
    id: baseId(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    prompt: text('prompt').notNull(),
    deadline: timestamp('deadline', { withTimezone: true, mode: 'date' }),
    status: inputRoundStatus('status').notNull().default('open'),
    createdAt: ts('created_at'),
  },
  (t) => ({
    decisionIdx: index('decision_input_rounds_decision_idx').on(t.decisionId),
  }),
);

// Explicit target set so "unanswered" is (targets minus submitted).
export const decisionInputTargets = pgTable(
  'decision_input_targets',
  {
    id: baseId(),
    roundId: uuid('round_id')
      .notNull()
      .references(() => decisionInputRounds.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    roundUserUq: uniqueIndex('decision_input_targets_round_user_uq').on(t.roundId, t.userId),
  }),
);

export const decisionInputs = pgTable(
  'decision_inputs',
  {
    id: baseId(),
    roundId: uuid('round_id')
      .notNull()
      .references(() => decisionInputRounds.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stance: inputStance('stance').notNull(),
    rationaleMd: text('rationale_md').notNull(),
    submittedAt: ts('submitted_at'),
  },
  (t) => ({
    roundUserUq: uniqueIndex('decision_inputs_round_user_uq').on(t.roundId, t.userId),
    roundIdx: index('decision_inputs_round_idx').on(t.roundId),
  }),
);
```

Note: the roadmap sketch for `decision_inputs` lists `(id, round_id, user_id, stance,
rationale_md, submitted_at)`, which this matches. The `decision_input_targets` table is
an addition so "unanswered requests" is a set difference rather than an inference from
the RACI roster (which can change after a round opens). If the user prefers to avoid a
third table, the alternative is to snapshot targets as a JSONB `target_user_ids` array
on the round; the separate table is cleaner for the "remind unanswered" query in Theme C.

### B2: sign-off columns on `decisions`

```ts
// added to the existing decisions table
signedOffByUserId: uuid('signed_off_by_user_id').references(() => users.id, {
  onDelete: 'set null',
}),
signedOffAt: timestamp('signed_off_at', { withTimezone: true, mode: 'date' }),
```

No new status enum value. `decidedAt` continues to be the decided-time stamp;
`signedOffAt` records specifically that the Accountable approved (they are stamped
together on the sign-off path, but stay distinct so an admin status correction that sets
`accepted` without sign-off does not falsely imply approval).

### B3: templates

```ts
export const decisionTemplates = pgTable(
  'decision_templates',
  {
    id: baseId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: decisionTemplateKind('kind').notNull().default('custom'),
    // Encoded governance: role shape, rounds to open, required fields. JSONB so the
    // model evolves without a migration per tweak. Validated by a zod schema in shared.
    spec: jsonb('spec').notNull().default(sql`'{}'::jsonb`),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    workspaceIdx: index('decision_templates_workspace_idx').on(t.workspaceId),
  }),
);
```

`spec` shape (validated in shared, not the DB):

```ts
const templateSpec = z.object({
  roles: z.array(z.object({ role: raciRole, userId: uuid.optional() })).max(100),
  rounds: z
    .array(z.object({ prompt: z.string().max(2000), deadlineDays: z.number().int().min(1).max(365).optional() }))
    .max(10),
  requiredFields: z.array(z.enum(['descriptionMd', 'area', 'expectedOutcomeMd'])).default([]),
});
```

### B4: no new table required for slice 1

Notifications are transient jobs, not records. The event to job mapping and the mail
send are stateless (BullMQ holds the job; the audit trail records the triggering
mutation). A `decision_notifications` audit/ledger table (per-recipient delivery record)
is deferred to Theme C, where per-person acknowledgement makes a record necessary
(`decision_acknowledgements`). For B4, observability comes from worker logs plus the
existing `sendEmail` result.

## 5. Core service layer additions

All new logic lives in `@palouse/core` under the decisions area, exported from
`packages/core/src/index.ts` (which already exports `decisionService`). Services take
`(db, workspaceId, actor, ...)`, write `auditEvents` via the existing `audit()` helper,
and emit decision events (section 9). New files:

- `packages/core/src/decisions/input-rounds.ts` (B1)
- `packages/core/src/decisions/signoff.ts` (B2) or a method added to `service.ts`
- `packages/core/src/decisions/templates.ts` (B3)
- `packages/core/src/decisions/events.ts` (B4 mapping, shared with Theme C)

Re-export the new functions from the `decisionService` namespace so callers keep using
`decisionService.openInputRound(...)` etc.

### B1 functions

- `openInputRound(db, workspaceId, actor, decisionId, input)`: loads the decision
  (reuse `loadDecisionRow`, currently private, promote or duplicate), inserts the round
  and its target rows in a transaction, writes `decision.input_round_opened` audit,
  emits an `input_requested` event per target. Default targets = current `consulted` +
  `informed` stakeholders when the caller passes none.
- `submitInput(db, workspaceId, actor, roundId, input)`: verifies the round is `open`
  and not past deadline, upserts `decision_inputs` on `(round_id, user_id)`
  (`onConflictDoUpdate`), writes `decision.input_submitted` audit. Agents may submit
  (actor can be agent) but the `user_id` on the row must be a real workspace user, so
  the agent path requires an explicit `userId` argument; the human path uses the session
  user.
- `closeInputRound(db, workspaceId, actor, roundId)`: flips `status` to `closed`,
  audit `decision.input_round_closed`.
- Reads: extend `getDecision`'s `DecisionDetail` to include `inputRounds` with, per
  round, the stance tallies and the unanswered target list. Compute tallies with a
  grouped `count(*)` keyed by round id (mirroring the list-counts pattern already in
  `listDecisions`, service.ts lines 129-152) rather than N+1 queries.

### B2 function

- `signOffDecision(db, workspaceId, actor, decisionId, { decision: 'accept' | 'reject', note? })`:
  1. Actor must be a user and must hold the `accountable` role on this decision (query
     `decision_stakeholders`). Throw `forbidden` otherwise.
  2. Guarded UPDATE in the handoff style: set `status`, `signed_off_by_user_id`,
     `signed_off_at = now()`, and `decided_at = coalesce(decided_at, now())` **only
     where** `status = 'under_review'`. Zero rows returned means the decision was not in
     review, so throw `conflict('Decision is not awaiting sign-off')`.
  3. The existing exactly-one-Accountable check in `updateDecision` is redundant here
     because we already verified the actor is the sole Accountable, but keep the DB-level
     invariant intact by not bypassing it: sign-off calls a shared internal
     `finalizeDecision` helper that both this and `updateDecision` use.
  4. Audit `decision.signed_off`; emit `decision_finalized` event.

Interaction with existing `updateDecision`: keep `updateDecision` able to set any status
for admin corrections, but the *product* forward-path (the UI "Accept"/"Reject" buttons)
goes through `signOffDecision`. Optionally tighten `updateDecision` to reject a direct
`under_review` to `accepted` jump by non-Accountable actors; decide this in the open
questions (section 15) since it is a behavior change for existing MCP `update_decision`.

### B3 functions

- `listTemplates` / `createTemplate` / `updateTemplate` / `archiveTemplate`, all
  workspace-scoped, `spec` validated by the shared `templateSpec` zod.
- `applyTemplate(db, workspaceId, actor, templateId, createInput)`: resolves the
  template, merges its `roles` into the create input's stakeholders, creates the
  decision via existing `createDecision`, then opens each templated round via
  `openInputRound`. Runs in one transaction so a half-applied template never lands.
- Seed helper `ensureDefaultTemplates(db, workspaceId)`: lazily inserts the four
  canonical governance templates the first time a workspace lists templates. Advice =
  one Accountable plus consulted advisors, one advice round. Consent = round whose
  `block` stance is meaningful. Consensus = all-agree target. DACI = Driver/Approver/
  Contributors/Informed mapped onto RACI (Driver -> responsible, Approver ->
  accountable, Contributors -> consulted, Informed -> informed).

### B4 layer

See section 9. Core exposes `decisionEvents.emit(queue, event)` and a pure
`mapEventToJobs(event, recipients)`; services call `emit` after their audit write.

## 6. API routes

Add to `apps/api/src/routes/decisions.ts`. Every route stays behind `requireSession`
and `requireDecisionsAccess` exactly as the existing routes do. Parse bodies with new
shared zod DTOs; pull `workspaceId` via the existing `bodyWorkspaceId` helper for POST/
PUT/PATCH and the query param for GET/DELETE.

B1:
- `POST /:id/input-rounds` -> `openInputRound`.
- `POST /input-rounds/:roundId/inputs` -> `submitInput` (or nest under the decision:
  `POST /:id/input-rounds/:roundId/inputs`; nested is more consistent with the existing
  `/:id/resources/:resourceId` style, prefer it).
- `POST /:id/input-rounds/:roundId/close` -> `closeInputRound`.
- Rounds and their tallies come back inside `GET /:id` (extended `DecisionDetail`), so
  no separate list endpoint is needed for slice 1.

B2:
- `POST /:id/sign-off` -> `signOffDecision`, body `{ decision: 'accept' | 'reject',
  note?, workspaceId }`.

B3:
- `GET /templates?workspaceId=` -> `listTemplates` (calls `ensureDefaultTemplates`
  first).
- `POST /templates`, `PATCH /templates/:templateId`, `DELETE /templates/:templateId`.
- `POST /?templateId=` is the simplest apply path: extend the existing create route to
  accept an optional `templateId` and route to `applyTemplate`.

## 7. MCP tools to add

Declared in `packages/mcp-sdk/src/index.ts` (`TOOLS`, `TOOL_INPUTS`, `TOOL_DESCRIPTIONS`)
and wired in `apps/mcp/src/server.ts` (`SCOPES`, `CAPABILITY`, a `register()` block).
All new tools take `decisions` capability and existing `decisions:read`/`decisions:write`
scopes, so full-access (`*`) keys pick them up automatically with no re-mint (the
wildcard behavior noted in memory). No new scope enum values needed.

- `request_decision_input` (scope `decisions:write`): open a round. Args: `decisionId`,
  `prompt`, `deadline?` (datetime), `targetUserIds?` (defaults to consulted+informed).
  Description should tell the agent to use this after summarizing a discussion that needs
  sign-off from named stakeholders.
- `submit_decision_input` (scope `decisions:write`): args `roundId`, `userId` (the
  stakeholder the agent is recording input for), `stance`, `rationaleMd`. Because an
  agent is recording on behalf of a person, `userId` is required (unlike the human web
  path). Rationale required.
- `get_decision` already returns detail; extend its output to include input rounds and
  tallies so agents can read stance state. No new tool needed for reads.

Deliberately **not** exposing sign-off (B2) to agents: the Accountable is a human
approving; an agent signing off would defeat the control. Templates (B3) are a
workspace-admin authoring concern, also not agent-exposed in slice 1.

## 8. Web UI

Primary surface is `apps/web/src/components/decision-detail-sheet.tsx`, which already
renders RACI, relations, resources, and comments as stacked `<Separator/>`-divided
sections. Add sections and wire new `api` client methods in `apps/web/src/lib/api.ts`.
Reuse label/tone helpers in `apps/web/src/lib/decision-meta.ts` (add
`STANCE_LABELS`/`STANCE_TONE` there).

B1 input-round UI (new `InputRoundsSection`):
- List open and closed rounds with the prompt, deadline, and a stance tally row (four
  small pill counts using existing `Badge`, tone from `decision-meta`). Show unanswered
  targets as muted names.
- A stance widget for the current user when they are a target of an open round: four
  buttons (Agree / Concerns / Block / Abstain) plus a required rationale `Textarea`,
  submitting via `api.submitDecisionInput`. Disable submit until rationale is non-empty.
- An "Request input" affordance for owners: pick targets from `members` (already loaded
  in the sheet), a prompt, and a deadline.

B2 sign-off UI:
- When status is `under_review` and the current user is the Accountable stakeholder,
  replace the raw status `Select` finalize path with explicit "Accept" and "Reject"
  buttons calling `api.signOffDecision`. Show who signed off and when once finalized
  (from the new `signedOffBy`/`signedOffAt` fields on the decision DTO).
- Keep the status `Select` for other transitions; just gate the forward finalize move.

B3 template picker in `apps/web/src/components/new-decision-dialog.tsx`:
- A template `Select` at the top of the dialog, populated from `api.listTemplates`.
  Choosing one pre-fills the roster (RaciPicker), pre-seeds the round prompts, and marks
  required fields. Submitting posts `templateId` alongside the create payload.
- Template authoring (create/edit) is a `/settings` admin surface; scope it to a thin
  first version (name, kind, roles, rounds) and expand later.

## 9. Queue and mail: the reusable decision-event notification layer

This is the load-bearing, reuse-first part. Build it so Theme C plugs in without
touching the shape.

### Queue producer (`packages/queue/src/index.ts`)

The `notifications` queue name exists but has no factory. Add, mirroring the sync/handoff
factories:

```ts
export const NOTIFICATION_JOBS = {
  decisionEvent: 'notifications.decision_event',
} as const;

export interface DecisionNotificationJob {
  workspaceId: string;
  kind:
    | 'accountable_assigned'
    | 'input_requested'
    | 'decision_finalized'; // Theme C extends this union
  decisionId: string;
  recipientUserId: string;
  // Small event-specific payload (round id, decision title snapshot, etc.).
  data: Record<string, unknown>;
}

export function createNotificationsQueue(connection: IORedis) {
  return new Queue<DecisionNotificationJob>(QUEUE_NAMES.notifications, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  });
}

export async function enqueueDecisionNotification(
  queue: NotificationsQueue,
  job: DecisionNotificationJob,
) {
  // One job per (kind, decision, recipient) so retries dedupe.
  await queue.add(NOTIFICATION_JOBS.decisionEvent, job, {
    jobId: `notif-${job.kind}-${job.decisionId}-${job.recipientUserId}`,
  });
}
```

### Core event emitter (`packages/core/src/decisions/events.ts`)

A pure mapper plus a thin emit. Services call `emit` after their audit write, passing the
already-resolved recipient user ids (so the mapping stays testable and side-effect-free):

- `accountable_assigned`: emitted from `setStakeholders`/`createDecision`/`applyTemplate`
  when a user becomes the `accountable` for a decision they were not previously
  accountable for.
- `input_requested`: emitted from `openInputRound`, one per target user.
- `decision_finalized`: emitted from `signOffDecision` (and from `updateDecision`'s
  finalize path), to the full RACI roster.

The emitter must not fail the mutation: enqueue with a `.catch()` that logs, exactly as
the MCP `enqueuePush(...).catch(() => {})` pattern already does in `server.ts`.

### Worker consumer (`apps/worker/src/notifications.ts`, new; wired in `apps/worker/src/index.ts`)

A third `Worker` on `QUEUE_NAMES.notifications`, alongside the sync and handoff workers.
For each job it:
1. Resolves the recipient's email (join `users` on `recipientUserId`; skip and log if the
   user has no verified email).
2. Renders subject/body from a per-`kind` template (section 11), building links from
   `env.WEB_BASE_URL`.
3. Calls `sendEmail`, then **logs the outcome including `result.sent` and
   `result.skippedReason`** so a no-op (missing `RESEND_API_KEY`) is visible in worker
   logs. This is the explicit fix for the prior silent-no-op gotcha.

Because Theme C's rollout/escalation/supersession events are just more `kind` values on
the same job type and mapping, C reuses this consumer wholesale.

## 10. Capability gating and config

- All Theme B surfaces sit under the existing `decisions` capability. API routes go
  behind `requireDecisionsAccess`; MCP tools list `decisions` in the `CAPABILITY` map so
  they auto-hide when the capability is off. No new `CAPABILITY_KEYS` entry.
- New MCP tools use existing `decisions:read`/`decisions:write` scopes; wildcard keys
  inherit them automatically.
- No new required env vars. Notifications are best-effort: with `RESEND_API_KEY` unset,
  the worker logs and skips (mail stays optional infrastructure per the mail package
  contract). `WEB_BASE_URL` (already required in config) supplies notification links.
- Optional future config: a per-workspace `notificationsEnabled` toggle. Not required
  for slice 1; if added later it fits the capability-config JSONB pattern the roadmap
  mentions rather than a new capability key.

## 11. Copy considerations (em-dash-free, verified against the standing rule)

All strings below use periods, commas, and parentheses, never em-dashes; en-dash only
for empty-value placeholders. These are user-facing (email + web + API errors), so the
rule is strictly enforced.

Email subjects and headings:
- `accountable_assigned`: subject "You are now Accountable for a decision". Heading
  "You are the Accountable owner". Body: "You have been made the Accountable owner of the
  decision \"{title}\" in your Palouse workspace. Review it and sign off when it is
  ready." CTA "View decision".
- `input_requested`: subject "Your input is requested on a decision". Body: "{opener} is
  asking for your stance on \"{title}\". Please share whether you agree, have concerns,
  want to block, or abstain, with a short reason." If a deadline is set, add "Input is
  due by {date}." CTA "Give your input".
- `decision_finalized`: subject "A decision was finalized: {title}". Body: "The decision
  \"{title}\" was {accepted or rejected} by {accountable}." CTA "View decision".

Web microcopy:
- Stance labels: "Agree", "Concerns", "Block", "Abstain".
- Empty states: "No input rounds yet.", "No one has responded yet."
- Unanswered placeholder in a tally cell uses en-dash "–" per the established convention.
- Sign-off buttons: "Accept" and "Reject"; confirmation "Only the Accountable owner can
  sign off a decision."

API error strings (thrown via existing `validation`/`forbidden`/`conflict`):
- "Only the Accountable owner can sign off this decision."
- "This decision is not awaiting sign-off."
- "This input round is closed."
- "A rationale is required with your stance."

## 12. Testing

Follow the existing package test layout (services tested against a real Postgres via the
testcontainers setup already in the repo; API routes via Hono app tests; MCP via the
server builder).

- Core (B1): open round defaults targets to consulted+informed; submit upserts on
  resubmission; submit after deadline or on a closed round throws; tallies and unanswered
  set computed correctly; agent submit requires an explicit `userId`.
- Core (B2): sign-off requires the actor to be the sole Accountable; sign-off from a
  non-`under_review` status throws `conflict`; `signedOffAt` and `decidedAt` both stamped;
  the single-Accountable invariant still holds; an admin `updateDecision` correction path
  still works.
- Core (B3): `applyTemplate` creates decision + rounds atomically (a failure rolls both
  back); `ensureDefaultTemplates` is idempotent; `spec` zod rejects malformed specs.
- Core/queue (B4): `mapEventToJobs` is a pure function with table-driven cases per kind;
  emit failures do not fail the triggering mutation; the worker logs `sent` vs
  `skippedReason` (assert the log line, given the silent-no-op history).
- API: each new route enforces `requireDecisionsAccess` (403 when capability off, 403
  when not a member).
- MCP: `request_decision_input` and `submit_decision_input` are hidden when the
  `decisions` capability is off; present for a wildcard key; audited via `auditToolCall`.
- Copy guard: a unit test asserting no `—` in the notification copy module (there is
  a precedent for treating the em-dash rule as testable).

## 13. Ordered tracer-slice breakdown (with effort)

Each slice is thin end-to-end (DB + core + API + one surface), shippable, and pausable
for feedback, per the tracer-bullet principle. Suggested order within Theme B:

1. **B2 sign-off (S).** Smallest, highest-value, no new tables (two columns + one
   service action + `POST /:id/sign-off` + Accept/Reject buttons). Ships the ownership
   gate on its own. Migration adds two columns.
2. **B4 notification rails, minimal (M).** Build the `notifications` queue factory,
   producer, event emitter, and worker consumer, wired to just the `decision_finalized`
   event from slice 1 so it is exercised end-to-end with one kind. This is the reusable
   layer; getting it right here pays off in Theme C. Log-on-send from day one.
3. **B1 input rounds (M).** New tables, service, nested API routes, `get_decision`
   detail extension, the `InputRoundsSection` and stance widget in the sheet, plus
   `request_decision_input`/`submit_decision_input` MCP tools. Emits `input_requested`
   into the slice-2 rails and adds the `accountable_assigned` event.
4. **B3 templates (M/L).** New table, service, `applyTemplate`, default seeding, the
   template picker in `new-decision-dialog`, and a thin admin authoring surface. Larger
   because of the authoring UI; the apply path itself is small since it composes existing
   create + open-round.

Rationale for order: sign-off is independently valuable and unblocks the "finalized"
event; the rails come next so every subsequent feature emits into a proven layer; input
rounds are the marquee B feature but lean on the rails; templates are last because they
are a convenience wrapper over everything before them and carry the most UI.

## 14. Cross-theme dependencies and shared entities

- **Theme C reuses the B4 notification layer directly.** C1 (rollout announcements), C2
  (escalation reminders), and C3 (supersession propagation) are additional `kind` values
  on `DecisionNotificationJob` and additional cases in `mapEventToJobs`, consumed by the
  same worker. This is why B4 is built as a mapping, not one-off `sendEmail` calls. Do
  not let B4 collapse into inline sends.
- **`decision_input_targets` feeds Theme C's reminders.** The "unanswered targets" query
  is the same shape C2 needs for "non-acknowledgers". Keeping targets as rows (not a
  JSONB snapshot) makes that reuse trivial.
- **Sign-off (`signedOffAt`) feeds Theme D reporting.** Time-to-decision and "aging in
  review" (D1) get more precise with an explicit sign-off timestamp distinct from
  `decidedAt`.
- **Templates are workspace-scoped like capabilities.** They live next to the
  workspace-capabilities pattern and could later be governed by the same admin surface.
- **Shared enums must stay in lockstep.** Every new pg enum (`decision_input_stance`,
  `decision_input_round_status`, `decision_template_kind`) needs its zod twin in
  `packages/shared/src/decision.ts` with the existing "keep in sync" comment, or MCP and
  web will drift.

## 15. Open questions and decisions for the user

1. **Does a `block` stance hard-block acceptance, or just flag it?** Options: (a)
   advisory only, sign-off can proceed over a block (simplest, matches "advice" and
   "DACI" governance); (b) sign-off is refused while any open round has an unresolved
   `block` (matches "consent"); (c) behavior is driven by the applied template's `kind`.
   Recommendation: ship (a) as the default and make (b) a template-driven rule in B3, so
   slice 1 is simple and governance nuance arrives with templates. Needs a decision.
2. **Should `update_decision` (web status Select and the MCP tool) still be able to jump
   `under_review` to `accepted` directly, bypassing sign-off?** Recommendation: keep it
   for admins/corrections but route the product path through sign-off; optionally warn.
   This affects existing MCP behavior, so confirm.
3. **Who may open an input round?** Any member, or only the Accountable/Responsible
   owners? Recommendation: any member can open, since input-gathering is collaborative;
   revisit if it gets noisy.
4. **Required rationale on `agree`/`abstain` too, or only on `concerns`/`block`?**
   Recommendation: require a short rationale on all four for a complete record, but this
   is a UX friction call.
5. **Targets: separate `decision_input_targets` table, or a JSONB snapshot on the
   round?** Recommendation: the table (better for Theme C reminders), but flagged since
   it is one more table than the roadmap sketch names.
6. **Template authoring depth for slice 1:** ship read-only default templates first
   (advice/consent/consensus/DACI seeded), and defer custom authoring UI? Recommendation:
   yes, seed the four and defer the authoring surface to a follow-up so B3 stays M not L.
7. **Notification opt-out / digest:** per-user email preferences are out of scope here;
   confirm that best-effort per-event email (no digest, no unsubscribe beyond workspace
   membership) is acceptable for slice 1.
