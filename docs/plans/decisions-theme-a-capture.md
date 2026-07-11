# Theme A: Capture — implementation plan

Status: plan (2026-07-11). Companion to `docs/decisions-roadmap.md` (read §1 market
findings, §3 Theme A, and §5 constraints first). This document turns Theme A into a
buildable spec grounded in the current codebase. Every code reference below was verified
against the tree on 2026-07-11.

Migration numbering note: the current max migration is `0018_webhook-hardening.sql`.
Migration numbers are assigned by `drizzle-kit` at implementation time. This document
never hardcodes a number; where a migration is required it says "next migration".

**Resolved 2026-07-11 (open question 4, M365 entry point):** lead with whatever is
fastest right now. That is the Copilot declarative agent on the existing MCP server (A2):
it reuses `mcp.palouse.ai` and our OAuth provider and needs no new connector, extraction
pipeline, or LLM dependency. Sequence A2 first; defer the `ms_meetings` transcript
connector (A3), the generic ingest pipeline (A4), and the extraction service until after
the agent path proves the inbox UX. The `ConnectorAdapter` interface-fit question for
`ms_meetings` therefore does not block near-term work.

---

## 1. Title, goal, and roadmap goals served

**Title:** Theme A — Capture decisions as they are made.

**One-line goal:** Turn meeting exhaust (Microsoft 365 / Copilot, Teams transcripts, and
third-party meeting-AI tools) into `proposed` decisions that land in a review inbox with
source provenance, so a human accepts, merges, or dismisses them.

**Roadmap goals served:** primarily goal 1 (capture decisions as they are being made).
It seeds goal 2 (ownership/stakeholders) because extracted candidates suggest RACI from
attendees, and it produces the volume that makes goal 4 (reporting) worth building. It is
the top of the funnel every later theme consumes.

---

## 2. Prerequisites and dependencies on other themes

Theme A is self-contained enough to ship first, with these caveats:

- **No dependency on Themes B–E.** The inbox writes plain `proposed` decisions through
  the existing `decisionService`, which already supports `origin: 'agent'`, RACI with
  single-Accountable enforcement, relations, and the audit trail. Nothing in B–E must
  land first.
- **Soft ordering suggestion from the roadmap:** the roadmap sequences strategy linkage
  (E1/E2) as the fastest visible win and puts the Teams connector (A3) late because it
  carries the most external-surface risk. This plan honours that: A1 (inbox) and A4
  (generic ingest) come first inside Theme A; A3 (Teams) is deliberately last.
- **New infrastructure Theme A introduces that later themes reuse:**
  - An **extraction pipeline** (LLM candidate-decision extraction) that runs on a new
    BullMQ queue. This is net-new: there is no LLM client dependency in the repo today
    (`@anthropic-ai/sdk` is not installed; `packages/config` has no model key).
  - A **`decision_sources`** provenance table and a **review/inbox** service + UI.
  - A **`ms_meetings`** connector on the `microsoft-graph` base, and a **generic
    inbound-capture** webhook surface.
- **Azure app reuse:** the multi-tenant Entra app already registered for `ms_tasks`
  (see MEMORY: Azure app registration, appId `55cd94ae…`) is reused for `ms_meetings`.
  New Graph permissions must be added to that app's manifest (`OnlineMeetingTranscript.
  Read.All` / RSC equivalents). This is an Azure-portal change, not code.
- **OAuth provider reuse:** `@better-auth/oauth-provider` is already wired in
  `apps/api/src/app.ts` with dynamic client registration (DCR) and an `oauthClients`
  table. A2 needs one *static, preregistered* client row in that table; the DCR flow
  stays untouched for Copilot Studio and other MCP clients.

---

## 3. Refined sub-feature scope

| Sub | Scope in this theme | Notes |
|---|---|---|
| **A1 Decision inbox** | New `decision_sources` provenance table; inbox review-queue UI (accept / merge / dismiss); a `reviewStatus` concept on proposed decisions so accepted ones leave the queue. Agent-proposed decisions already work; this adds provenance + review UX. | Foundational. Everything else feeds it. |
| **A2 Copilot declarative agent** | Mint one static OAuth client for the Teams developer portal; author a v2.4 `RemoteMCPServer` manifest pointing at `mcp.palouse.ai`; package for per-tenant custom-app upload (pilot) then Partner Center (GA). | Mostly config + manifest + docs; the MCP server and OAuth provider already exist. No new decision code. |
| **A3 Teams meeting capture** | New `ms_meetings` adapter on `microsoft-graph`; Graph change-notification on transcript creation; fetch `.vtt` post-meeting; run extraction; emit `proposed` decisions into the inbox. RSC per-meeting consent alongside tenant admin consent. Graceful degradation when speaker attribution is off. | Highest external-surface risk. Ship last inside the theme. |
| **A4 Generic capture ingest** | Inbound webhook endpoint + Zapier-friendly API accepting Fireflies (`meeting.summarized`), Read AI, Fellow payloads; normalize to a common capture envelope; run the same extraction. | Positions Palouse as the decision router none of those tools ship. |
| **A5 Meeting AI Insights premium** | For Copilot-licensed tenants, classify pre-structured `callAiInsight` (`meetingNotes`, `actionItems`, mentions) instead of raw VTT. Delegated permission, no channel meetings. | Premium enhancement path, not the base. Reuses the extraction pipeline's "structured summary" input mode. |
| **Extraction pipeline** | Queue worker step that turns a transcript or summary into candidate decisions (title, description, suggested area, suggested stakeholders from attendees, confidence). Shared by A3/A4/A5. | Net-new LLM dependency + config + queue. |

Explicitly **out of scope** for Theme A: real-time/live meeting capture (needs a media
bot; roadmap §5 rules it out for slice 1); any stakeholder input rounds, sign-off,
rollout, or notifications (Themes B/C).

---

## 4. Data model changes

New tables live in a new schema file `packages/db/src/schema/capture.ts` (decision-source
provenance and capture envelopes), exported from `packages/db/src/schema/index.ts`. The
`ms_meetings` provider value is a new member of the existing `integration_provider` enum
in `packages/db/src/schema/integrations.ts`. Conventions match the tree: `snake_case`
columns, `gen_random_uuid()` PKs, `timestamp(..., { withTimezone: true, mode: 'date' })`.

### 4.1 Enum additions

- `integration_provider`: add `'ms_meetings'`. (Postgres `ALTER TYPE … ADD VALUE`.)
- New enum `capture_source_system`: `['ms_meetings','ms_ai_insights','fireflies',
  'read_ai','fellow','manual','other']` — labels the origin of a captured decision.
- New enum `decision_review_status`: `['pending','accepted','merged','dismissed']` — the
  inbox disposition of a `proposed`, agent-originated decision. `pending` = still in the
  inbox; the others are terminal review outcomes.

### 4.2 `decision_sources` (provenance, A1)

One row per external source that produced a decision. A decision may have more than one
source over its life (e.g. discussed in two meetings), so this is one-to-many, not a
column on `decisions`.

```ts
export const captureSourceSystem = pgEnum('capture_source_system', [
  'ms_meetings', 'ms_ai_insights', 'fireflies', 'read_ai', 'fellow', 'manual', 'other',
]);

export const decisionSources = pgTable('decision_sources', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid('workspace_id').notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  decisionId: uuid('decision_id').notNull()
    .references(() => decisions.id, { onDelete: 'cascade' }),
  sourceSystem: captureSourceSystem('source_system').notNull(),
  // Optional link back to the connector row that produced this (null for
  // generic-ingest and manual sources).
  integrationId: uuid('integration_id')
    .references(() => integrations.id, { onDelete: 'set null' }),
  externalRef: text('external_ref'),          // meeting id / event id / call id
  externalUrl: text('external_url'),          // deep link back to the meeting/recap
  meetingTitle: text('meeting_title'),
  meetingStartedAt: timestamp('meeting_started_at', { withTimezone: true, mode: 'date' }),
  excerpt: text('excerpt'),                   // the transcript/summary span we extracted from
  // 0..1 model confidence; nullable for manual/human-added sources.
  confidence: doublePrecision('confidence'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull().defaultNow(),
}, (t) => ({
  decisionIdx: index('decision_sources_decision_idx').on(t.decisionId),
  workspaceIdx: index('decision_sources_workspace_idx').on(t.workspaceId),
}));
```

### 4.3 Review status on decisions (A1)

The inbox needs to distinguish "proposed, awaiting review" from "proposed but a human is
still drafting it manually." Add a nullable `review_status` column to `decisions` (in
`decisions.ts`). NULL = a normal, human-authored decision that never entered the inbox;
non-NULL = a captured candidate with an inbox disposition. This keeps the inbox query a
simple `review_status = 'pending'` filter and leaves existing rows untouched.

```ts
// added to the existing `decisions` table in decisions.ts
reviewStatus: decisionReviewStatus('review_status'),        // nullable
mergedIntoDecisionId: uuid('merged_into_decision_id')
  .references((): any => decisions.id, { onDelete: 'set null' }), // set on 'merged'
```

`decision_review_status` pgEnum is added in `decisions.ts` next to `decisionStatus`.
Index: `decisions_workspace_review_idx` on `(workspaceId, reviewStatus)` for the inbox.

### 4.4 `capture_envelopes` (A4/A3/A5 raw ingest ledger)

Persist every inbound capture (raw payload hash + normalized envelope) before extraction,
mirroring how `webhook_deliveries` gives sync idempotency. This lets extraction run/retry
on the queue without losing the source, and gives an audit trail of what was ingested.

```ts
export const captureEnvelopes = pgTable('capture_envelopes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid('workspace_id').notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  sourceSystem: captureSourceSystem('source_system').notNull(),
  integrationId: uuid('integration_id')
    .references(() => integrations.id, { onDelete: 'set null' }),
  externalRef: text('external_ref'),
  // Dedup key: sha256 of the raw payload; unique per (workspace, source, hash).
  payloadHash: text('payload_hash').notNull(),
  // Normalized capture: { meetingTitle, startedAt, attendees[], transcriptText?,
  //   summaryText?, structuredInsights? }. jsonb so each source maps into one shape.
  envelope: jsonb('envelope').notNull(),
  status: text('status').notNull().default('pending'),   // pending|extracted|failed|ignored
  extractedAt: timestamp('extracted_at', { withTimezone: true, mode: 'date' }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull().defaultNow(),
}, (t) => ({
  dedupUq: uniqueIndex('capture_envelopes_ws_source_hash_uq')
    .on(t.workspaceId, t.sourceSystem, t.payloadHash),
  wsStatusIdx: index('capture_envelopes_ws_status_idx').on(t.workspaceId, t.status),
}));
```

### 4.5 Generic-ingest credentials (A4)

Inbound webhooks from Zapier/Fireflies need a per-workspace shared secret to authenticate
without an OAuth round-trip. Store it on a small table so it can be rotated:

```ts
export const captureIngestTokens = pgTable('capture_ingest_tokens', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid('workspace_id').notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  // Store only a sha256 hash of the token; the plaintext is shown once at mint.
  tokenHash: text('token_hash').notNull(),
  createdByUserId: uuid('created_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull().defaultNow(),
}, (t) => ({
  hashIdx: uniqueIndex('capture_ingest_tokens_hash_uq').on(t.tokenHash),
}));
```

The `ms_meetings` connector's OAuth tokens, webhook subscription, and cursor reuse the
existing `integrations`, `sync_cursors`, and `webhook_deliveries` tables unchanged. Note
`webhook_deliveries.provider` is `integration_provider`, so adding `'ms_meetings'` to
that enum lets Graph transcript notifications flow through the existing delivery ledger.

**Migration:** one "next migration" adds all three tables, both new enums, the enum value
`ms_meetings`, the two new columns on `decisions`, and the indexes. Generated with
`pnpm --filter @palouse/db drizzle:generate` after editing the schema files.

---

## 5. Core service layer additions

New services under `packages/core/src/`, exported from `@palouse/core` (same pattern as
`decisionService`, all taking `(db, workspaceId, actor, …)` and writing `audit_events`).

### 5.1 `captureService` (`packages/core/src/capture/service.ts`)

- `ingest(db, workspaceId, input)` — dedupe by `(workspaceId, sourceSystem, payloadHash)`,
  insert a `capture_envelopes` row (`onConflictDoNothing`), return whether it was novel.
  Called by the generic-ingest route (A4), the `ms_meetings` webhook path (A3), and the
  AI-Insights path (A5). Does **not** run extraction inline; it enqueues an extraction job.
- `listInbox(db, workspaceId, query)` — decisions where `review_status = 'pending'`, joined
  to their `decision_sources`, ordered by newest source. Powers the inbox UI.
- `acceptCandidate(db, workspaceId, actor, decisionId)` — set `review_status = 'accepted'`;
  leaves the decision `proposed` (a human still advances the lifecycle). Audit
  `decision.capture_accepted`.
- `mergeCandidate(db, workspaceId, actor, decisionId, targetDecisionId)` — copy the
  candidate's `decision_sources` onto the target, set `review_status = 'merged'` and
  `merged_into_decision_id`, optionally append the candidate description as a comment on
  the target. Audit `decision.capture_merged`.
- `dismissCandidate(db, workspaceId, actor, decisionId, reason?)` — set
  `review_status = 'dismissed'`. Audit `decision.capture_dismissed`.
- `mintIngestToken` / `listIngestTokens` / `revokeIngestToken` — manage A4 secrets.

### 5.2 `extractionService` (`packages/core/src/extraction/`)

- `extractCandidates(envelope): Promise<CandidateDecision[]>` — the LLM step. Input is a
  normalized envelope (transcript text, or a pre-structured summary for A5). Output is an
  array of `{ title, descriptionMd, suggestedArea, suggestedStakeholders[], confidence,
  excerpt }`. `suggestedStakeholders` are resolved best-effort from attendee emails to
  workspace `users`; unresolved attendees are dropped (the decision still lands).
- `persistCandidates(db, workspaceId, envelopeId, candidates)` — for each candidate above a
  confidence floor, call `decisionService.createDecision` with `origin: 'agent'` (actor =
  a dedicated system/connector agent, see §9.5), set `review_status = 'pending'`, and
  insert a `decision_sources` row linking back to the envelope. Below-floor candidates are
  recorded on the envelope but not turned into decisions.

The LLM client is a new thin wrapper (`packages/core/src/extraction/model.ts`) over the
Anthropic Messages API. **This is the project's first LLM dependency** — see §9.6 for the
model choice and config. The extraction step MUST degrade gracefully: no attribution =
`suggestedStakeholders: []`; a decision with no identifiable decider still lands in the
inbox for a human to assign (roadmap §5 constraint).

### 5.3 `decisionService` touch-ups

- Extend `createDecision` input plumbing so the capture path can set `reviewStatus` and
  attach `decision_sources` atomically (either a new `createCapturedDecision` helper or an
  optional field on the existing input — prefer a dedicated helper to keep the public
  create path clean).
- Extend `getDecision`'s `DecisionDetail` to include `sources: DecisionSource[]` so the
  detail sheet can show provenance (§8).

---

## 6. API routes

New Hono route files under `apps/api/src/routes/`, registered in `apps/api/src/app.ts`.

### 6.1 `capture.ts` (session-guarded, behind the decisions capability)

Reuse the `requireDecisionsAccess(db, workspaceId, userId)` pattern from `decisions.ts`
(membership + `capabilitiesForWorkspace().decisions !== false`).

- `GET /capture/inbox?workspaceId=…` → `captureService.listInbox`.
- `POST /capture/decisions/:id/accept` → `acceptCandidate`.
- `POST /capture/decisions/:id/merge` (body `{ targetDecisionId }`) → `mergeCandidate`.
- `POST /capture/decisions/:id/dismiss` (body `{ reason? }`) → `dismissCandidate`.
- `GET|POST|DELETE /capture/ingest-tokens` → mint/list/revoke A4 secrets (admin only;
  reuse the workspace-admin check used by team/capability settings).

### 6.2 `capture-ingest.ts` (public, token-guarded, A4)

Separate router mounted without `requireSession`, rate-limited via the existing
`RATE_LIMIT_WEBHOOK_PER_MIN` bucket (or a new `RATE_LIMIT_INGEST_PER_MIN`, mirroring the
existing `RATE_LIMIT_IMPORT_PER_MIN`).

- `POST /ingest/:workspaceId` with `Authorization: Bearer <ingest-token>` — verify token
  hash against `capture_ingest_tokens` (constant-time, same helper style as
  `tokensMatch` in `webhooks.ts`); body is a provider-tagged payload. Normalize via a
  per-provider adapter (Fireflies `meeting.summarized`, Read AI, Fellow), call
  `captureService.ingest`, enqueue extraction, return `202`.
- Provider detection: either a `?provider=fireflies` query param or sniff the payload
  shape. Fireflies sends a `meeting.summarized` event with a transcript URL that must be
  fetched with the Fireflies API key (store per-workspace in `integrations.config` or a
  dedicated secret — see open questions §15).

### 6.3 Graph transcript webhook (A3)

Extend `apps/api/src/routes/webhooks.ts`. The existing Graph receiver route matcher is
`/:provider{ms_tasks|ms_todo}/:integrationId/:nonce`. Add `ms_meetings` to that matcher
(and the legacy route). The validation-token echo, `clientState` hash check, and
`recordAndEnqueue` idempotency all already exist and apply unchanged; only the provider
union type in `recordAndEnqueue` widens to include `'ms_meetings'`. The enqueued sync job
routes to the `ms_meetings` adapter, which fetches the `.vtt` and ingests it (§9).

---

## 7. MCP tools to add

**None required for the base theme.** The existing `create_decision`, `list_decisions`,
`update_decision`, `add_decision_relation`, and `set_decision_stakeholders` tools already
let a Copilot/Teams agent (A2) log and query decisions. A2 is a manifest + OAuth-client
change, not new tools.

**Recommended optional additions** (each = update `packages/mcp-sdk/src/index.ts`
`TOOLS`/`TOOL_INPUTS`/`TOOL_DESCRIPTIONS`, add a `SCOPES` and `CAPABILITY` entry in
`apps/mcp/src/server.ts`, add a `register()` block; `'*'` keys auto-inherit):

- `list_decision_inbox` — list `review_status = 'pending'` candidates. Scope
  `decisions:read`, capability `decisions`. Lets a Copilot agent surface "you have N
  decisions to review."
- `propose_decision` — a thin alias/variant of `create_decision` that always sets
  `origin: 'agent'` + `review_status: 'pending'` and takes a `source` block (meeting
  title/time/excerpt/confidence) that writes a `decision_sources` row. Scope
  `decisions:write`. This gives meeting-AI agents (and A2's declarative agent) a
  first-class "propose into the inbox" verb distinct from directly creating a tracked
  decision. If added, prefer this over overloading `create_decision`.

Adding tools does not require a new agent scope: `decisions:read`/`decisions:write`
already exist in `packages/shared/src/agent.ts`.

---

## 8. Web UI

Next.js App Router under `apps/web/src/app/(app)/`; components in
`apps/web/src/components/`; API client methods in `apps/web/src/lib/api.ts`; meta/labels
in a new `apps/web/src/lib/capture-meta.ts`. Gated by the existing `decisions` capability
nav pattern (fail-closed via `CapabilityGate`).

- **Decision inbox page** `(app)/decisions/inbox/page.tsx` (or a tab on the existing
  `(app)/decisions/page.tsx`). Lists pending candidates as cards: title, suggested area,
  suggested stakeholders, confidence, and a source line ("From: Weekly Planning · Jul 8,
  logged 12 min after the meeting"). Per-card actions: **Accept**, **Merge into…**
  (opens a decision picker, reusing the `list_decisions`/`listDecisions` API and a
  combobox like the RACI/relations pickers), **Dismiss**. An inbox count badge on the
  Decisions nav item.
- **Provenance in the detail sheet.** Extend `decision-detail-sheet.tsx` with a new
  "Source" section rendering `detail.sources`: source system label, meeting title + time,
  a deep link (`ExternalLink` icon, like the resources section), and the excerpt in a
  muted block. Reuse the existing agent `Badge` treatment already in the sheet.
- **Merge affordance.** A `MergeDecisionDialog` component: pick a target decision, confirm,
  call `POST /capture/decisions/:id/merge`. On success, `onChanged()` refreshes the inbox.
- **Ingest settings** `(app)/settings/capture/page.tsx` (admin): mint/copy/revoke ingest
  tokens for A4, show the inbound webhook URL, and a copy-paste block of the Zapier/
  Fireflies setup steps. Also surface Microsoft meeting-capture connect (A3): the
  RSC per-meeting consent link and the tenant admin-consent link (built from
  `msAdminConsentUrl` in the microsoft-graph package).
- **Empty states** follow the Fieldwork design system (MEMORY: Fieldwork). Inbox empty
  state: "No decisions waiting for review. Captured decisions from meetings land here."

---

## 9. Connector / external-integration / queue / extraction-pipeline work

### 9.1 New queue for extraction

`packages/queue/src/index.ts` today defines `QUEUE_NAMES = { sync, handoff, notifications,
audit, housekeeping }` and only constructs `sync` and `handoff` queues. Add:

- `QUEUE_NAMES.extraction = 'extraction'` (or reuse `sync` with a new job name — a
  dedicated queue is cleaner because extraction is slow/LLM-bound and should not head-of-
  line-block fast sync jobs).
- `EXTRACTION_JOBS = { runExtraction: 'extraction.run' }` with payload
  `{ envelopeId: string }`, plus `createExtractionQueue`, `enqueueExtraction`, and a
  worker branch in `apps/worker/src/index.ts` calling
  `extractionService.extractCandidates` + `persistCandidates`.

### 9.2 `ms_meetings` connector (A3)

New package `packages/connectors/microsoft-meetings/` implementing `ConnectorAdapter`
from `@palouse/connector-core`, composed on the `microsoft-graph` base exactly as
`microsoft-tasks` composes To Do + Planner:

- `system: 'ms_meetings'`, `pollOnly: false`.
- `buildAuthUrl` / `exchangeCode` / `refreshTokens`: reuse `msBuildAuthUrl` /
  `msExchangeCode` / `msRefreshTokens`, but with a **transcript scope set** instead of
  `Tasks.ReadWrite`. Add an override so `MS_SCOPES` isn't hardcoded for this connector
  (the graph base currently hardcodes `MS_SCOPES`; parameterize or add a
  meetings-specific scope constant, e.g. `OnlineMeetingTranscript.Read.All` for
  tenant-wide, and document the RSC scopes `OnlineMeetingTranscript.Read.Chat` /
  `ChannelMeetingTranscript.Read.Group` which are granted per-meeting by the organizer/
  team owner, not requested in the auth URL).
- `subscribeWebhook`: `graphCreateSubscription` with `resource` set to the transcript
  change resource (`/communications/onlineMeetings/getAllTranscripts` or the per-meeting
  transcript resource) and `changeType: 'created'`. `renewWebhook`: reuse
  `graphRenewSubscription` (the base already caps lifetimes and renews inside ~2 days;
  the existing subscription-renewal sweep handles it).
- `pull(ctx)`: on a transcript-created notification, fetch the transcript metadata then
  GET the `.vtt` content (`…/transcripts/{id}/content?$format=text/vtt`) with the
  delegated/app token. Return the VTT + meeting metadata as a capture envelope rather
  than tasks — i.e. this adapter does **not** normalize into `NormalizedExternalTask`;
  it produces capture envelopes. That is a shape mismatch with the current
  `ConnectorAdapter` (which returns `PullResult { tasks }`). Two options:
  1. Give the meetings adapter its own narrow interface and wire it directly in the
     worker's webhook handler (recommended — the adapter interface is task-shaped and
     forcing meetings through it is awkward), or
  2. Extend `PullResult` with an optional `captures?: CaptureEnvelope[]` field.
  Prefer option 1: the `ms_meetings` webhook delivery is processed by a dedicated worker
  branch that calls a meetings-specific fetch, writes a `capture_envelopes` row via
  `captureService.ingest`, and enqueues extraction. See open questions §15.
- **Post-meeting only:** there is no live transcript API. The webhook fires on transcript
  creation, which is minutes after the meeting ends. Set that expectation in copy.
- **Degrade on attribution off:** if the VTT has no speaker labels (Teams admin toggle
  off), extraction still runs; deciders come back empty and the candidate lands for human
  assignment.

### 9.3 A5 Meeting AI Insights path

For Copilot-licensed tenants, instead of fetching `.vtt`, call the Graph
`callAiInsight` endpoint (delegated) to get structured `meetingNotes`, `actionItems`, and
mentions, and pass those to `extractionService.extractCandidates` in "structured summary"
mode (skip the transcript-parsing prompt, classify the pre-structured insight). No channel
meetings (Graph restriction). This is an alternate `envelope` shape
(`structuredInsights`), not a new pipeline. Requires the Meeting-AI-Insights delegated
permission on the Entra app.

### 9.4 Generic ingest (A4)

Per-provider normalizers in `packages/core/src/capture/providers/` (fireflies.ts,
read-ai.ts, fellow.ts) mapping each vendor payload into the common envelope. Fireflies
`meeting.summarized` carries IDs and a transcript URL that must be fetched with the
workspace's Fireflies API key. Read AI and Fellow are prose-summary sources (roadmap §1
table: both are "prose only") so their envelope is `summaryText`, not `transcriptText`.

### 9.5 System connector agent

Captured decisions are `origin: 'agent'`, and `decisionService.createDecision` records
`created_by_agent_id`. Provision a per-workspace (or per-integration) system agent row so
provenance and audit attribute cleanly to "Palouse Capture" rather than a user. The
`agents` table + `agentService` already exist; add a well-known system agent kind or reuse
`kind: 'custom'` with a reserved name.

### 9.6 Model / LLM client

There is no LLM SDK in the repo today. Add `@anthropic-ai/sdk` and a thin client in
`packages/core/src/extraction/model.ts`. Model choice: default to a fast, cheap model for
this classification-style extraction (**Claude Haiku**, current-generation) with the
model id read from config so it is swappable; escalate to Sonnet only if extraction
quality on real transcripts is insufficient. New config keys in `packages/config/src/
index.ts`: `ANTHROPIC_API_KEY` (optional; extraction is a logged no-op when unset, exactly
like `RESEND_API_KEY` gates mail) and `PALOUSE_EXTRACTION_MODEL` (default to the chosen
Haiku model id). Report token usage through the existing usage ledger if the extraction
agent should show cost (optional; the usage service exists).

> Before implementing the model wrapper, load the `claude-api` skill to confirm the
> current Haiku/Sonnet model ids, pricing, and Messages API params. Do not hardcode a
> model id from memory.

---

## 10. Capability gating and config

- **Reuse the `decisions` capability** for all of A1–A5. The inbox, provenance, ingest,
  and connector all sit under Decisions; gating them separately would fragment the UX.
  The API routes reuse `requireDecisionsAccess`; the MCP tools (if added) reuse
  `CAPABILITY['…'] = 'decisions'`; the web nav reuses the decisions `CapabilityGate`.
- **Do not add a new `CAPABILITY_KEYS` member** unless product wants capture toggled
  independently of decisions. If they do, the roadmap already anticipates either a new
  sub-capability key or a `config` JSONB on `workspace_capabilities` — prefer the JSONB
  config route for a per-workspace "capture enabled" flag so the top-level capability list
  stays short.
- **Config summary (all optional, no-op when unset):** `ANTHROPIC_API_KEY`,
  `PALOUSE_EXTRACTION_MODEL`, optional `RATE_LIMIT_INGEST_PER_MIN`, and the static-OAuth-
  client id/secret for A2 (see §12/§15). The `ms_meetings` connector reuses the existing
  `MICROSOFT_OAUTH_CLIENT_ID/SECRET`.

---

## 11. Copy considerations

Strict rule (CLAUDE.md, MEMORY): no em-dashes (U+2014) in any user-facing copy. Use
periods, commas, colons, parentheses; en-dash (U+2013) only for empty-value placeholders.
Proposed strings below already follow this.

- Post-meeting latency, set expectations honestly: "Logged a few minutes after the meeting
  ends." Never imply live capture.
- Inbox framing: "Review captured decisions." Actions: "Accept", "Merge into an existing
  decision", "Dismiss".
- Attribution-off degradation: "We could not identify who decided this. Assign an
  Accountable owner when you review it."
- Onboarding docs (A3) must cover both Teams admin toggles: speaker attribution (off by
  default) and transcript Graph-access controls (enforced from 2026-07-29). Write these in
  `docs/` (internal docs may use em-dashes but prefer not to).
- Confidence display: show as a short label ("High/Medium/Low confidence") rather than a
  raw float in the primary UI.

---

## 12. Testing approach

- **Unit (vitest):** extraction normalizers (each provider payload → envelope), the VTT
  parser, `captureService` accept/merge/dismiss transitions (including that merge copies
  sources and stamps `merged_into_decision_id`), confidence-floor filtering, and graceful
  degradation (no attribution → empty stakeholders, candidate still persisted).
- **Extraction step:** test `persistCandidates` against a fake/stubbed model client (do
  not call the live API in tests); assert it calls `decisionService.createDecision` with
  `origin: 'agent'` + `review_status: 'pending'` and writes a `decision_sources` row.
- **API route tests** (pattern like `apps/api/src/routes/webhooks.test.ts`): ingest token
  auth (valid/invalid/revoked, constant-time), dedupe on replayed payloads, capability
  gate on the inbox routes, Graph validation-token echo for `ms_meetings`.
- **Integration (testcontainers Postgres, already used):** end-to-end for one slice — a
  simulated Fireflies `meeting.summarized` POST lands a `capture_envelopes` row, the
  extraction worker (with a stubbed model) produces a `proposed` decision with
  `review_status = 'pending'` and a `decision_sources` row, and the inbox query returns it.
- **Connector tests:** point `PALOUSE_MS_GRAPH_API_BASE` at a fake server (the graph base
  already supports this override) to test subscription create/renew and VTT fetch.
- **Migration:** verify the enum `ADD VALUE` and new tables apply cleanly on a copy of
  prod schema; enum value additions cannot run inside a transaction with certain
  Postgres versions, so check the generated SQL.

---

## 13. Ordered tracer-slice breakdown (within Theme A)

Each slice is thin, end-to-end, and shippable. Effort: S (~days), M (~1 week), L (~2+
weeks). Build principle: ship the thinnest end-to-end slice, pause for feedback, expand.

1. **Inbox foundation + manual capture (A1 core).** [M]
   Schema: `decision_sources`, `decisions.review_status` + `merged_into_decision_id`,
   `decision_review_status` enum. `captureService` (listInbox/accept/merge/dismiss). API
   `capture.ts`. Web inbox page + provenance section in the detail sheet. Seed the inbox
   by letting an authenticated user (or the existing MCP `create_decision`) mark a
   decision as a pending candidate. No LLM, no external integration yet. This proves the
   review UX the roadmap wants validated before A3.

2. **Extraction pipeline + generic ingest (A4).** [L]
   Add the extraction queue, the Anthropic client + config, `extractionService`,
   `capture_envelopes`, `capture_ingest_tokens`, the `capture-ingest.ts` public route, and
   the Fireflies normalizer (one provider first). End-to-end: POST a summary → envelope →
   extraction → `proposed` candidate in the inbox. Add Read AI / Fellow normalizers as
   fast-follow. Ingest-token settings UI.

3. **Copilot declarative agent (A2).** [S–M]
   Mint one static OAuth client row in `oauthClients` (fixed redirect URI
   `https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect`, auth-code flow, confirm
   the token endpoint returns no 307). Author the v2.4 `RemoteMCPServer` manifest pointing
   at `mcp.palouse.ai`. Package for per-tenant custom-app upload (pilot). Verify the
   optional `propose_decision`/`list_decision_inbox` MCP tools if slice 1/2 added them.
   Mostly config, manifest, and docs; no new decision code. GA later via Partner Center.

4. **Teams meeting capture connector (A3).** [L]
   New `microsoft-meetings` connector, Graph transcript subscription + VTT fetch, worker
   branch feeding `captureService.ingest` → extraction. RSC per-meeting consent link +
   tenant admin-consent link in settings. Onboarding docs for both admin toggles.
   Graceful degradation when attribution is off. Highest external risk; deliberately after
   the inbox and pipeline are proven.

5. **Meeting AI Insights premium path (A5).** [M]
   Add the delegated Meeting-AI-Insights permission, the `callAiInsight` fetch, and the
   "structured summary" extraction mode. Gate to Copilot-licensed tenants. Smallest new
   surface because it rides slices 2 and 4's pipeline.

Recommended pause-for-feedback points: after slice 1 (does the review UX land?) and after
slice 2 (does extraction quality justify auto-proposing?).

---

## 14. Cross-theme dependencies and shared entities

- **Feeds Theme B (ownership/input).** Extracted candidates already suggest RACI from
  attendees; B1 input rounds and B2 sign-off operate on the decisions this theme creates.
  Accepting a candidate is the natural hand-off point into B's workflow.
- **Feeds Theme C (change management).** Rollouts (C1) launch off accepted decisions; the
  faster decisions get captured and accepted, the more rollout volume exists.
- **Feeds Theme D (reporting).** `decided_at` is already stamped by `decisionService`;
  `decision_sources.confidence` and `source_system` add capture-quality and channel-mix
  reporting dimensions. Time-from-source-to-accepted becomes measurable.
- **Independent of Theme E (strategy linkage).** E wires `decision_relations` to
  objectives; capture writes decisions and relations through the same service, so once E
  lands, captured decisions can suggest objective/project links too, but neither blocks
  the other.
- **Shared entities and infra reused (not rebuilt):** `decisions` + `decisionService`
  (lifecycle, RACI, relations, audit); `decision_relations` (polymorphic, `goal` still
  reserved/unwired); `integrations` / `sync_cursors` / `webhook_deliveries` and the Graph
  webhook receiver; the BullMQ worker + subscription-renewal sweep; `@better-auth/
  oauth-provider` + `oauthClients`; the Entra multi-tenant app; the Fieldwork design
  system and `CapabilityGate`; the `decisions` capability. **New shared infra this theme
  introduces for others:** the extraction queue + LLM client, `capture_envelopes`, and the
  `decision_sources` provenance model.

---

## 15. Open questions / decisions for the user

1. **Separate capture capability?** Reuse the existing `decisions` capability (recommended)
   or add a distinct toggle (new `CAPABILITY_KEYS` member vs. a `workspace_capabilities`
   config flag)? Affects gating everywhere.
2. **Model + cost posture.** Confirm Claude Haiku as the extraction default (cheapest for
   classification) with Sonnet as the escalation, and whether extraction cost should flow
   through the usage ledger (visible spend) or stay internal. Confirm current model ids/
   pricing via the `claude-api` skill at build time.
3. **`propose_decision` MCP tool: add or not?** A dedicated inbox-proposing verb vs.
   overloading `create_decision`. Recommendation: add it so meeting-AI agents and the A2
   declarative agent have a clean "propose into the inbox" action.
4. **Meetings adapter interface.** The `ConnectorAdapter` contract is task-shaped
   (`PullResult { tasks }`). Give `ms_meetings` its own narrow interface wired directly in
   the worker (recommended), or extend `PullResult` with optional `captures`?
5. **Fireflies (and other vendor) API keys.** Where do per-workspace vendor API keys live:
   an `integrations` row with `config`, a dedicated secrets table, or reuse
   `capture_ingest_tokens`? Fireflies `meeting.summarized` requires a callback fetch, so a
   key is needed.
6. **A2 static OAuth client provisioning.** One static client shared across all tenants
   using the declarative agent, or one per tenant? A shared static client is simpler for
   the Teams developer portal registration; confirm it satisfies Microsoft's redirect-URI
   and no-DCR constraints, and that our token endpoint never returns a 307.
7. **Confidence floor + auto-accept.** What confidence threshold turns a candidate into an
   inbox item vs. discards it, and should high-confidence candidates ever skip the inbox?
   Recommendation for slice 1: everything above the floor goes to the inbox; never
   auto-accept until the review UX is validated.
8. **RSC rollout expectations.** Confirm the pilot tenants can grant resource-specific
   consent (admins can restrict it), and that transcript Graph-access controls (enforced
   2026-07-29) are handled in onboarding before A3 ships to any tenant.
9. **De-duplication across sources.** If the same meeting is captured by both Teams (A3)
   and a third-party tool (A4), should the inbox merge them or show duplicates? The
   `capture_envelopes` dedupe is per source system, so cross-source dedupe is a product
   decision (likely surface both and let merge handle it).
```

