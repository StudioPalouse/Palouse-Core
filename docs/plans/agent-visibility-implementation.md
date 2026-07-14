# Agent visibility: implementation plan (slice tracker)

> **Backlog tracked in Specboard.** Slices 1 to 3 are shipped (v0.21.0); slices 4 to 9 are epics
> in the **Agent Tracking** release. Specboard owns status; this slice tracker is retained as
> build-time reference. Reconciled 2026-07-14.

Status doc for building the agent-visibility capability. Companion to
`docs/agent-visibility-roadmap.md` (strategy, market landscape, themes A–E) and
`docs/agent-tasks-and-auditability.md` (original M5 plan; Phases 1–4 shipped, 5–6
absorbed into Theme B here). This file is the **execution** view: nine slices, each
with enough detail to resume cold if a session is interrupted.

Decisions locked 2026-07-13 (roadmap §6): nav area named **"Activity"** (internal
capability key `audit`); A2 human logging covers **all mutations**; approvals
per-workspace first; retention configurable + opt-in six-year preset; `audit`
capability **defaults on** (recording always on regardless).

Current migration head at planning time: `0019_strategy_linkage.sql`. Migration
numbers below are assigned at implementation time.

Status legend: `todo` · `in-progress` · `done` · `deferred`.

---

## Reconciliation: the audit spine is further along than the roadmap assumed

A codebase map on 2026-07-13 found the roadmap's Theme A gap analysis to be partly
stale. What the roadmap listed as slice-1 work (A1 entity targeting, A2 human logging,
update logging) is **largely already implemented**:

- **Every core service mutation already writes an entity-targeted audit event** with
  the correct `targetType`/`targetId` and correct actor. Confirmed in
  `packages/core/src/{tasks,decisions,objectives,projects}/service.ts`: create, update,
  comment, and relation mutations each call a local `audit(db, workspaceId, actor,
  action, targetId, payload)` helper that inserts `actorType: actor.type` (`user` |
  `agent`), `actorId: actor.id`, and the entity as the target. Updates already record
  `payload.fields = Object.keys(input)`.
- **Human web/REST mutations are already audited.** The web app has no private mutation
  path; it calls the REST API (`apps/api/src/routes/*.ts`), which builds
  `userActor(c.get('userId'))` and calls the same core services. So human creates and
  updates land in `audit_events` with `actorType: 'user'`. The roadmap's "human UI
  actions are invisible" is not true for these entities.
- **The actor abstraction already exists**: `packages/shared/src/actor.ts` —
  `Actor = { type: 'user' | 'agent'; id: string }`, with `userActor()` / `agentActor()`
  constructors threaded through every service and both entry points (MCP + REST).

What is genuinely **not** built:

- **No audit query API.** Nothing reads `audit_events` back out; compliance review would
  require direct DB access. (Roadmap B2.)
- **No activity feed / capability.** No web surface renders the log; no `audit`
  capability key. (Roadmap D1.)
- **Redundant MCP audit rows.** `apps/mcp/src/auth.ts:auditToolCall` writes a *second*
  row per MCP call — `action: 'mcp.<tool>'`, `targetType: 'agent'`, `targetId:
  agentId` — in addition to the entity event the underlying service already wrote. So
  every agent mutation double-logs (one clean entity row + one `mcp.*` agent-targeted
  row), and read-only MCP tools (`list_tasks`, `get_*`) produce *only* the `mcp.*` row.
  This is the sole place "MCP events target the agent not the entity" is real.
- **`audit_events` has no sanitizer on the service path.** The truncation / token-strip
  sanitizer lives only in `auditToolCall` (`SENSITIVE_ARGS`, `MAX_ARG_LENGTH = 500`).
  Service-path payloads today are just `{ fields: [...] }`, so low risk until A3 adds
  before/after values.

**Consequence for slice 1:** it shrinks. A1 and A2 are effectively done for the four
core entities; slice 1 becomes **the read side** (query API + feed + capability) plus an
**A1 cleanup decision** about the redundant `mcp.*` rows and an **A2 completeness sweep**
for any mutation that bypasses the service `audit()` helper.

### Slice-1 design decision: the `mcp.*` redundancy

The default activity feed is a "what happened to the work" view, so its spine is the
entity-targeted rows. The `mcp.*` rows are duplicates for mutations and low-value
(agent reads) otherwise. **Decision: filter at the read layer, do not touch the write
path.** The feed excludes `action LIKE 'mcp.%'` by default; the query API can return
them behind an explicit filter. This is reversible and keeps the hot write path
untouched. Revisit stopping the double-write only if the duplicate rows become a storage
or hash-chain concern (Theme B). **Resolved in slice 2: chain *all* rows, do not prune** —
the complete access record (including read-only tool calls) is the compliance value; the
read-layer filter still hides `mcp.*` from the default feed.

---

## Slice 1 — Complete record + activity feed  ·  status: done

**Shipped as PR #127** (merged to main 2026-07-13). Migration `0020_audit_capability`.

**Built 2026-07-13** (typecheck + prettier green across the workspace; DB-backed tests
written but not run locally — no Docker for Testcontainers, they run in CI):
- Shared: `packages/shared/src/audit.ts` (`listAuditEventsQuery`, `auditEventListItem`,
  result schema), exported from the shared index; `audit` added to `CAPABILITY_KEYS`.
- DB: `audit` added to the `capability_key` pgEnum; migration
  `0020_audit_capability.sql` (`ALTER TYPE ... ADD VALUE 'audit'`). **Not yet
  applied to any DB** — run `pnpm --filter @palouse/db migrate` against staging/prod at
  deploy.
- Core: `packages/core/src/audit/service.ts` — `listEvents` (facets, `mcp.*`
  read-layer filter, batched actor-name + target-label enrichment) and `summarize`
  (data-driven plain-English renderer), exported as `auditService`. Tests in
  `service.test.ts`.
- API: `apps/api/src/routes/audit.ts` — `GET /v1/audit/events`, session + `audit`
  capability gated; registered at `/v1/audit` in `app.ts`.
- Web: `audit`→"Activity" label + `/activity` route mapping; nav item (lucide
  `Activity` icon); `api.listAuditEvents` client; `app/(app)/activity/page.tsx` (feed
  with search + actor/target filters + 20s poll); `audit` added to the settings
  capabilities-card so admins can toggle the Activity area.

**Remaining before shippable:** run the feed against a real DB (apply migration, click
through with seeded human + agent events), confirm the capability toggle hides nav +
403s the API, run the test suite in CI, then wire the version bump / changelog like
prior capability rollouts.


**Goal.** A workspace member with the `audit` capability opens a nav-level **Activity**
page and sees a business-readable, filterable timeline of what humans and agents did to
tasks, decisions, objectives, and projects — backed by a new `GET /v1/audit/events`.
First slice that makes the capability visible and useful.

**Roadmap items:** A1 (already satisfied at the service layer; this slice adds the
read-layer `mcp.*` filter and a completeness sweep), A2 (verify all-mutations coverage),
B2 (query API), D1 (feed page + `audit` capability).

**Scope in / out.**
- In: query API, enriched read model (actor name, target label, plain-English summary),
  the Activity page (list + basic filters + poll), the `audit` capability wiring
  (default on), the `mcp.*` read-layer filter, the A2 sweep.
- Out (later slices): hash chain / "integrity verified" badge (slice 2), before/after
  diffs and per-entity Activity tabs (slice 3), exports (slice 4), MCP `query_audit`
  tool (defer; note the extension point), behavior signals / digests (slice 7).

### File checklist

Backend / shared:
1. `packages/shared/src/audit.ts` (new) — `listAuditEventsQuery` (zod: workspaceId,
   optional `action`, `actorType`, `targetType`, `search`, `from`/`to`, `limit`≤200,
   `offset`, and `includeReads` default false to toggle the `mcp.*` filter) and
   `auditEventListItem` (enriched: id, action, actorType, actorId, actorName, targetType,
   targetId, targetLabel, summary, payload, at). Export from
   `packages/shared/src/index.ts`.
2. `packages/db/src/schema/capabilities.ts` — add `'audit'` to the `capabilityKey`
   pgEnum. Requires migration (below).
3. `packages/shared/src/capability.ts` — add `'audit'` to `CAPABILITY_KEYS`.
4. `packages/db/migrations/00NN_add_audit_capability.sql` (generate via
   `pnpm --filter @palouse/db generate`) — `ALTER TYPE "public"."capability_key" ADD
   VALUE 'audit';`. Note: `ADD VALUE` cannot run in the same tx that uses the value;
   confirm the generated migration isn't wrapped problematically.
5. `packages/core/src/audit/service.ts` (new) — `listEvents(db, query)`:
   filter by workspace + optional facets, exclude `action LIKE 'mcp.%'` unless
   `includeReads`, order by `at desc`, paginate, return `{ events, total }`. Enrich:
   batch-resolve actor display names (users + agents tables) and target labels
   (per-`targetType` title lookup for task/decision/objective/project), and compute a
   plain-English `summary` per action via a renderer (see below). Export
   `auditService` from `packages/core/src/index.ts`.
6. `apps/api/src/routes/audit.ts` (new) — `GET /v1/audit/events`. `requireSession`,
   then `requireAuditAccess` (membership + `caps.audit !== false`, else `forbidden`).
   Parse query, call `auditService.listEvents`, return JSON. Register `app.route('/v1/
   audit', auditRoutes)` in `apps/api/src/index.ts`.

Web:
7. `apps/web/src/lib/capabilities.ts` — `CAPABILITY_LABELS.audit = 'Activity'`;
   `ROUTE_CAPABILITIES` add `{ prefix: '/activity', capability: 'audit' }`.
8. `apps/web/src/components/app-shell.tsx` — add NAV entry `{ href: '/activity', label:
   'Activity', icon: Activity, capability: 'audit' }` (import `Activity` from
   lucide-react), placed after Objectives, before Settings.
9. `apps/web/src/lib/api.ts` — `listAuditEvents(workspaceId, params)` client.
10. `apps/web/src/app/(app)/activity/page.tsx` (new) — list view mirroring the
    objectives page: workspace-scoped fetch, search + action/actor filters, 20s poll,
    skeleton + `EmptyState`, one row per event rendering `summary` with actor and target,
    relative timestamp, and a source badge (agent vs person). Fail-closed capability
    gate already handled by nav + route map.

Tests:
11. `packages/core/src/audit/service.test.ts` — seed mixed events, assert ordering,
    facet filters, `mcp.*` exclusion by default and inclusion with `includeReads`,
    enrichment (actor name + target label), pagination/total.
12. Route smoke test if the repo has an API test harness for other routes (mirror
    `decisions`/`objectives` route tests if present).

### Plain-English rendering

A small pure map from `action` → sentence template, fed the enriched actor/target
labels. Examples: `task.created` → "{actor} created task '{target}'"; `task.updated` →
"{actor} updated {fields} on task '{target}'"; `decision.updated` with a status field →
"{actor} moved decision '{target}' to {status}". Keep it a data table so it is easy to
extend and unit-test; unknown actions fall back to a generic "{actor} {action}
{target}". No em-dashes in any user-facing string (CLAUDE.md).

### API contract (draft)

`GET /v1/audit/events?workspaceId=&action=&actorType=&targetType=&search=&from=&to=&limit=&offset=&includeReads=`
→ `{ events: AuditEventListItem[], total: number }`. Default `limit` 50, max 200.
Ordered newest-first. 403 if the `audit` capability is off for the workspace (recording
still happens; only the read surface is gated).

### Acceptance criteria

- A human edit and an agent edit to the same task both appear in the feed with correct
  attribution and a readable summary.
- Read-only agent calls (`list_tasks`) do **not** clutter the default feed; they appear
  only with `includeReads=true`.
- Turning the `audit` capability off hides the nav item and returns 403 from the API;
  turning it on restores both. New workspaces default to on.
- Facet filters (actor type, action, target type, text search, date range) narrow the
  list; pagination returns a stable `total`.
- `pnpm typecheck` + `pnpm test` green; no em-dashes in copy.

### A2 completeness sweep — result (2026-07-13)

Swept every exported mutation vs its `audit()` call across the four core work-entity
services. **All fully covered**, one-to-one:
- tasks: create / update / comment (3/3).
- decisions: create / update / stakeholders / comment / resource add+remove / relation
  add+remove (8/8).
- objectives: create / update / key-result add+update+remove / project link+unlink
  (7/7); `importObjectives` delegates to the audited `createObjective` per row.
- projects: create / update / delete / column add+update+remove / item add+update+remove
  / dependency add+remove / task link+unlink / decision link+unlink (15/15).
- agents: create / archive / unarchive / delete / key create+revoke, via the agents
  service's own `audit()` helper.

So "all mutations day one" is satisfied for the work record with no new instrumentation
needed. **Deliberately deferred** (logged here, not silently skipped): workspace-admin
mutations that are not part of the work record — capability toggles, workspace/member
settings, and integration/connector config. Several already log through their own paths
(e.g. agent management). Instrumenting these into the same spine is a small follow-up,
tracked here; they do not belong in the default work-activity feed.

### Open items for slice 1

- Icon choice for the nav (`Activity` from lucide-react is the obvious pick).
- Whether target-label resolution should be one batched query per `targetType` or a
  single view; start with per-type batched lookups, optimize only if needed.

---

## Slice 2 — Hash chain + verification  ·  status: done

**Shipped to Test (staging) 2026-07-13 as PR #128** (squash `0d67f85`). Migration
`0021_audit_hash_chain` + the backfill ran via the api `release_command`
(`pnpm --filter @palouse/db migrate`); staging deploy (api/web/worker/mcp) + smoke green.
Follow-up commit kept `node:crypto` out of the web bundle by moving the hash utils to a
`@palouse/shared/audit-chain` subpath export (the barrel is browser-facing). Remaining
manual check: sign in to staging and confirm the Activity "Integrity verified" badge.

**Goal.** Make the record tamper-evident. Per-workspace `seq` / `prevHash` / `hash`
columns on `audit_events`, a single `appendAuditEvent` write funnel replacing the
per-service `audit()` helpers, a backfill CLI to chain historical rows, `GET
/v1/audit/verify`, `palouse verify-audit`, and an "Integrity verified" badge on the feed.
Fully designed in `docs/agent-tasks-and-auditability.md` Phases 5–6. Maps to SEC 17a-4's
audit-trail alternative to WORM; strongest regulated-industry differentiator per unit
effort. Size: M.

**Built 2026-07-13** (typecheck + prettier green; core 137 + api 35 tests pass; the
`pnpm --filter @palouse/db migrate` deploy path plus both CLIs verified against a real
Postgres container locally). Files:
- **shared**: `packages/shared/src/audit-chain.ts` — pure `canonicalJson` (RFC-8785-style
  sorted-key serialization), `sha256Hex`, `genesisHash(workspaceId)`,
  `computeAuditHash(fields)`, `AUDIT_CHAIN_VERSION = 1`. Lives in the leaf package so the
  core funnel and the db backfill share ONE canonicalization implementation.
  `AuditVerifyResult` schema added to `audit.ts`.
- **db**: `seq`/`prev_hash`/`hash` columns (nullable) + `audit_events_workspace_seq_uq`
  unique index on `schema/audit.ts`; migration `0021_audit_hash_chain`.
  `packages/db/src/audit-backfill.ts` (`backfillAuditChain`, idempotent, `(at,id)` order,
  advisory-locked per workspace) wired into `migrate.ts` after the catalog seed. Added a
  `@palouse/shared` dep to `@palouse/db` (leaf, no cycle).
- **core**: `packages/core/src/audit/chain.ts` — `appendAuditEvent(db|tx, evt)` (per-
  workspace `pg_advisory_xact_lock`, tip read, hash, insert; runs in a savepoint when the
  caller is already in a tx) and `verifyChain(db, workspaceId)`. All 6 service `audit()`
  helpers and the 5 direct inserters (`tasks/upsert`, `usage/service`, `mcp/auth`
  `auditToolCall`, `api/mcp-connect`, `api/otlp`) now funnel through it. Tests:
  `chain-hash.test.ts` (pure, 9) + `chain.test.ts` (Testcontainers, 7: gapless seq,
  concurrent writers, two-workspace isolation, tamper + deletion detection, backfill
  order + idempotency).
- **api**: `GET /v1/audit/verify` on the existing session + `audit`-capability-gated
  router.
- **cli**: `palouse verify-audit [--workspace <id>]` (non-zero exit on break) and
  `palouse backfill-audit-chain`.
- **web**: `api.verifyAudit` client + an "Integrity verified" / "Integrity check failed"
  badge (lucide `ShieldCheck`/`ShieldAlert`, `text-status-done` token) in the Activity
  header, re-walked on workspace change and each 20s poll.

**`mcp.*` redundancy decision (was the open prerequisite): chain everything, do not
prune.** A complete tamper-evident record of every tool call, including read-only access,
is the compliance value; pruning would destroy the access-log and touch the hot write
path. The slice-1 read-layer filter still hides `mcp.*` from the default feed. Revisit
only if storage becomes a concern.

**Acceptance met:** any row edit breaks verification at the tampered `seq`; a deleted row
breaks at the missing `seq` (verified by tests). Advisory-lock serialization gives
gapless per-workspace sequences under concurrent writers (8-way concurrent test).

**Deferred to later slices (noted, not silently skipped):**
- `verification.json` genesis-timestamp / backfill-honesty artifact lands with the audit
  package export (slice 4); `verifyChain` already reports `unchainedCount` for honesty in
  the meantime.
- A straggler row written by old code during the deploy cutover window stays `seq NULL`
  until the next `backfill-audit-chain` (which appends it after the live tip); surfaced as
  `unchainedCount` on the badge. Documented in `audit-backfill.ts`.
- Advisory-lock throughput at higher volume is not yet load-measured (roadmap §5 note).

## Slice 3 — Entity history + diffs  ·  status: done

**SHIPPED TO PROD 2026-07-13 as v0.21.0** (PR #129, squash `dd348ce`; tag on docs
commit `5b222c9`). This was the first prod release of the whole Activity capability
(slices 1+2+3): v0.20.0 predated the audit feature, so the prod api `release_command`
applied migrations 0020 (audit capability), 0021 (hash chain + backfill), and 0022
(comment agent authors), chaining all existing prod audit rows for the first time. Both
`deploy-staging` (on merge) and `deploy-prod` (on tag) ran green across api/web/worker/mcp
+ smoke. Migration `0022_comment_agent_author` confirmed applied on staging (`Migrations
complete`).

**Goal.** Before/after change payloads and a per-entity Activity section. Roadmap A3
(store changed-field old/new values in the update payload, reusing the `auditToolCall`
sanitizer discipline: truncation, token strip), A4 (`authorAgentId` on task + decision
comments so agent comments are attributed directly, not inferred), D2 (an "Activity"
section on task / decision / objective / project detail views showing every audited
action on that record, human and agent, with the diffs). Depends on slice 1's entity
targeting (already satisfied) and the query API. **Acceptance:** opening a decision shows
its full change history with old→new values; agent comments show the agent as author.
Size: M.

**Built 2026-07-13** (typecheck green across all 27 packages; prettier clean; core 146 +
api 35 tests pass, including the new DB-backed entity-history suite run against a real
Postgres container locally). Migration `0022_comment_agent_author`. Files:

- **A3 — before/after diffs.** `packages/core/src/audit/changes.ts` — pure
  `diffAuditChanges(before, after, fields)` diffs two entity DTOs over the changed input
  keys and returns a `{ field: { from, to } }` map, sanitizing with the MCP discipline
  (`MAX_AUDIT_VALUE_LENGTH = 500` truncation, Dates → ISO). Only genuinely-changed fields
  land, so a no-op patch yields `{}`. Wired into all four `update*` mutations: `tasks`
  now pre-fetches the current row (it did not before); `objectives`/`projects` captured
  the row their `loadXRow` already fetched; `decisions` reused its existing `existing`.
  The diff rides in `payload.changes`, so it is hash-chained and tamper-evident (slice 2).
  Diffing at the DTO level (both sides through the service's own `toDto`) keeps date/enum
  normalization identical on both sides. Exported from the core index.
- **A4 — direct comment attribution.** Migration adds nullable `author_agent_id` (FK
  agents, `on delete set null`) to `task_comments` + `decision_comments`; schema + shared
  `taskCommentSchema`/`decisionCommentSchema` gain `authorAgentId` and a resolved
  `authorName`. `packages/core/src/audit/comment-authors.ts` batch-resolves author display
  names (users by name/email, agents by name), used by `getTask`/`getDecision` and on the
  single row `addComment` returns. Both services now set `authorAgentId` on agent comments
  instead of leaving the author null.
- **D2 — per-entity Activity.** `targetId` filter added to `listAuditEventsQuery` + the
  read service + the web `api.listAuditEvents` client. `audit-event-row.tsx` extracts the
  feed row (now shared by the workspace feed and every entity view) and renders the
  before/after diffs as `field: old → new` with the changed value struck through; the
  activity page was refactored onto it. `entity-activity.tsx` fetches
  `{ targetType, targetId }` and renders an "Activity" section (Separator-bounded, matching
  the existing sheet-section pattern rather than a new tab component) on the task /
  decision / objective detail sheets and the project detail page. Agent comments in the
  task + decision sheets now show the agent name + a Bot glyph via `authorName`.

**Design notes / deviations (logged, not silently skipped):**
- The plan said "Activity **tab**"; the detail views are Sheets built from linear
  Separator-bounded sections, so the Activity view is a section, not a tab, for
  consistency and lower risk. Same information, native to the existing layout.
- Per-entity queries are naturally free of `mcp.*` chatter: those rows target the agent,
  never the entity id, so `targetId` scoping excludes them without needing `includeReads`.
- The `mcp.*` sanitizer was **not** physically shared into core; `changes.ts` re-states
  the same discipline (500-char truncation) close to where entity fields are diffed. The
  MCP logger works on tool-call arg shapes, so a forced abstraction would have coupled two
  differently-shaped call sites. Kept as parallel implementations with a comment linking
  them.
- Project **item** cards (`project-item-detail-sheet.tsx`) did not get an Activity
  section this slice — item mutations audit under `targetType: 'project'` (the project id),
  not a per-item target, so there is no per-card history to show yet. Noted for a later
  slice if per-item audit targeting is added.

**Remaining before shippable:** apply migration `0022` at deploy
(`pnpm --filter @palouse/db migrate`), click through a seeded task/decision with mixed
human + agent edits and comments to confirm the diffs and agent attribution render, then
wire the version bump / changelog like prior capability rollouts.

## Slice 4 — Auditor exports  ·  status: todo

**Goal.** The "hand this to your auditor" moment. Per-handoff Activity Report PDF + CSV;
workspace audit-package zip (chained JSONL, usage CSV, `verification.json`, a README
documenting the hash recipe for independent re-verification). Roadmap B3; SEC 17a-4
requires downloading records *with* their audit trail, and this package is that
download. Depends on slice 2 (chain) and slice 1 (query API). First demo-able export
artifact; warrants a beta-customer conversation after this lands. Size: M.

## Slice 5 — Registry + access transparency  ·  status: todo

**Goal.** Turn the Agents area into a compliance-grade registry (C1: accountable human
owner, vendor/framework, purpose, models observed from `llm_generations`, environment,
risk tier, next review date — grounded in observed activity, not self-declaration),
plus access transparency (C2: per-agent granted scopes vs actually-used scopes from
audit events, flagging over-provisioned/wildcard keys with least-privilege suggestions)
and credential hygiene (C3: optional key expiry, rotation + stale-key surfacing, steer
regulated workspaces toward OAuth). Size: M.

## Slice 6 — Approval checkpoints  ·  status: todo

**Goal.** Per-workspace policy for which agent actions need human review before taking
effect, generalizing the existing handoff `review_required` gate (C4). Enforcement in
the service layer; pending-approval queue reuses the reviews UX. **Decision (2026-07-13):
per-workspace policy first; design the policy schema so per-agent overrides can be added
later without migration churn.** Per-feature config via the `config` JSONB pattern, not
new enums. Size: M/L.

## Slice 7 — Digests + behavior signals + live status  ·  status: todo

**Goal.** The proactive layer, most valuable once volume exists. D3: extend
`narrateHandoff` to agent-level and workspace-level "what your agents did this week"
digests (in-app card + optional email via the decisions-roadmap notification rails). D4:
dashboard behavior signals computed from audit + usage data — off-hours activity, volume
spikes, first use of a tool/scope, failure-rate spikes, cost spikes vs the rollup
baseline; reuse the strategy-signals dashboard pattern, heuristic thresholds, no ML. D5:
"what is running right now" from `agent_handoffs` / `handoff_steps` (active claims,
current step, last heartbeat) — a read-side view over existing data. Size: M.

## Slice 8 — Retention + compliance mapping  ·  status: todo

**Goal.** B4 retention plumbing + E3 buyer-facing mapping. **Decision (2026-07-13):
configurable-only with an opt-in six-year (FINRA 4511) preset — not default-on.** A
workspace retention setting; audit + usage rows excluded from workspace-deletion flows
while a hold is active; document what is and is not deletable (the retention-vs-GDPR-
erasure tension is a deliberate policy call, not an implementation default). E3: a short,
honest control-mapping doc (later a trust page) tying features to EU AI Act Art. 12,
SOC 2, and SEC/FINRA recordkeeping expectations — precise, no over-claiming (we record
agent actions *in the workspace*, not total agent behavior). Size: S/M.

## Slice 9 — Content capture policy + external archive  ·  status: todo

**Goal.** E1: an explicit workspace-level opt-in for prompt/completion content capture on
OTLP ingest and MCP payloads, with masking rules — ship with capture **off** (the OTel
GenAI spec excludes content by default; the Salesforce masking-gap finding shows how
badly it reads when trust controls lag). E4: scheduled export of the audit stream to
customer-owned storage (S3 with object lock for WORM, or a SIEM webhook) per the
`cloud/audit-export` sketch. Cloud-tier feature. Size: L.

---

## Sequencing notes

Slices 1–3 are the credible core ("complete, provable, explainable"). Beta-customer
conversation warranted after slice 3, and again after slice 4 with the export artifact
in hand. Themes cut *across* slices deliberately (e.g. Theme B appears in slices 2, 4,
8), so build by slice, not by theme.

## Cross-cutting constraints (from roadmap §5)

- Audit writes are the hot path; slice 1 raises volume before slice 2 adds the chain.
  Keep the funnel async-safe; measure before adding the advisory lock.
- Self-reported data is labeled, not trusted — carry source badges (MCP-reported vs
  OTLP vs observed) into the UI, mirroring the cost engine's self-reported/computed split.
- Content is sensitive by default; do not widen payload capture without slice 9's opt-in
  and masking. The current sanitizer (truncation, claim-token strip) is the floor.
- No em-dashes in any user-facing copy (CLAUDE.md); en-dash `–` only for empty-cell
  placeholders.
</content>
</invoke>
