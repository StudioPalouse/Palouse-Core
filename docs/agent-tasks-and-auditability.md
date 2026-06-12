# ReqOps — Agent Tasks (M5 Runtime) + Agent Visibility & Auditability

Implementation plan. Status: **Phase 1 complete** — migration `0002`, handoff state machine, agents service + keys, reaper worker, REST `agents.ts`/`handoffs.ts`, CLI `create-agent`/`create-agent-key`, MCP server (stdio + streamable HTTP, all 9 §6 tools + 3 resources, per-call agent-key auth + audit), and the basic web UI (handoff panel in the task sheet, review queue at `/reviews`). Phases 2–6 remain. Companion to `docs/architecture.md` (§5 handoff lifecycle, §6 MCP design, §9 queues).

## Context

ReqOps already has the *schema* for agent handoffs (M5: `agents`, `agent_api_keys`, `agent_handoffs`, `handoff_events`) but the runtime is stubbed — no state machine service, no MCP tools, no UI. Separately, customers need **agent visibility & auditability**: business users and their auditors must be able to see, in plain English, how an agent acted on a task, which models it used, how many tokens it consumed, and what it cost — and export that as an auditor-ready artifact.

The constraint that shapes everything: **ReqOps is MCP-first; agents run outside ReqOps**. We never see their LLM calls directly, so usage data must be captured via (a) agent self-reporting through MCP tools and (b) an optional OpenTelemetry (OTLP) ingest endpoint for instrumented agents. We borrow data-model best practices from Langfuse (trace → generation hierarchy, model price catalog), OpenTelemetry GenAI semantic conventions (attribute names), and append-only/hash-chained audit log patterns — but the UX is deliberately non-technical: narratives, not trace waterfalls.

### Locked decisions (user-confirmed 2026-06-10)

1. **Capture path**: dual — MCP self-report (usage fields on lifecycle tools + dedicated `log_step` / `report_usage` tools) **and** an OTLP/HTTP ingest endpoint accepting OTel GenAI spans.
2. **Audit depth**: business-friendly dashboard + exportable PDF/CSV reports + **tamper-evident hash-chained append-only event log** with a verification endpoint/CLI.
3. **Scope**: build the M5 handoff runtime and the observability layer **together** — every state transition and usage report flows into one audit spine from day one.
4. **Cost engine**: built-in **versioned model price catalog** (effective-dated, per-1M-token) + per-workspace overrides; cost computed at ingest and reproducible later (price snapshot stored per row). Agent-self-reported cost is stored separately, never trusted as the computed figure.

---

## 1. Schema

### 1a. Run/step/generation hierarchy — flattened, two new child tables

Langfuse uses recursive trace → observation → generation. ReqOps does not need recursion: **`agent_handoffs` IS the trace**. Two flat children keep queries trivial and map directly to the plain-English timeline:

```
agent_handoffs (exists)
  ├── handoff_events   (exists — lifecycle transitions, unchanged)
  ├── handoff_steps    (NEW — narrative units: "Read the task", "Drafted report")
  └── llm_generations  (NEW — one row per LLM call / usage report, optionally linked to a step)
```

New file `packages/db/src/schema/usage.ts` (register in `packages/db/src/schema/index.ts`):

```ts
export const usageSource = pgEnum('usage_source', ['mcp', 'otlp']);
export const priceSource = pgEnum('price_source', ['catalog', 'workspace_override', 'self_reported', 'unpriced']);

export const handoffSteps = pgTable('handoff_steps', {
  id: baseId(),
  handoffId: uuid('handoff_id').notNull().references(() => agentHandoffs.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),                      // per-handoff ordering, assigned by service
  title: text('title').notNull(),                     // plain English, agent-supplied
  detailMd: text('detail_md'),
  status: text('status').notNull().default('completed'), // started|completed|failed
  source: usageSource('source').notNull().default('mcp'),
  otelSpanId: text('otel_span_id'),
  startedAt: timestamp(...), endedAt: timestamp(...),
  createdAt: ts('created_at'),
}, (t) => ({ handoffSeqUq: uniqueIndex('handoff_steps_handoff_seq_uq').on(t.handoffId, t.seq) }));

export const llmGenerations = pgTable('llm_generations', {
  id: baseId(),
  handoffId: uuid('handoff_id').notNull().references(() => agentHandoffs.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull(),        // denormalized for rollups
  agentId: uuid('agent_id').notNull(),                // denormalized
  stepId: uuid('step_id').references(() => handoffSteps.id, { onDelete: 'set null' }),
  source: usageSource('source').notNull(),
  model: text('model').notNull(),                     // as reported, e.g. 'claude-opus-4-8'
  provider: text('provider'),                         // 'anthropic' | 'openai' | ... (from catalog or gen_ai.system)
  inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
  outputTokens: bigint(...).notNull().default(0),
  cacheReadTokens: bigint(...).notNull().default(0),
  cacheWriteTokens: bigint(...).notNull().default(0),
  // --- cost snapshot: reproducible forever ---
  costUsd: numeric('cost_usd', { precision: 14, scale: 8 }),        // null = unpriced
  selfReportedCostUsd: numeric(... ),                                // stored separately, never overwrites computed
  priceSource: priceSource('price_source').notNull().default('unpriced'),
  modelPriceId: uuid('model_price_id').references(() => modelPrices.id, { onDelete: 'set null' }),
  priceSnapshot: jsonb('price_snapshot').$type<PriceSnapshot>(),    // {inputPerM, outputPerM, cacheReadPerM, cacheWritePerM, catalogVersion}
  otelTraceId: text('otel_trace_id'),
  otelSpanId: text('otel_span_id'),
  occurredAt: ts('occurred_at'),
  createdAt: ts('created_at'),
}, (t) => ({
  handoffIdx: index(...).on(t.handoffId),
  workspaceDayIdx: index(...).on(t.workspaceId, t.occurredAt),
  otlpDedupeUq: uniqueIndex('llm_generations_otel_span_uq').on(t.handoffId, t.otelSpanId), // partial: WHERE otel_span_id IS NOT NULL
}));
```

### 1b. Price catalog + workspace overrides

Same file:

```ts
export const modelPrices = pgTable('model_prices', {
  id: baseId(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),                     // canonical id, exact match first
  matchPattern: text('match_pattern'),                // prefix pattern: 'claude-opus-4-8' matches 'claude-opus-4-8[1m]'
  inputPerMUsd: numeric('input_per_m_usd', { precision: 12, scale: 6 }).notNull(),
  outputPerMUsd: numeric(...).notNull(),
  cacheReadPerMUsd: numeric(...),
  cacheWritePerMUsd: numeric(...),
  effectiveFrom: timestamp(...).notNull(),
  effectiveTo: timestamp(...),                        // null = current
  catalogVersion: text('catalog_version').notNull(),  // e.g. '2026-06-10.1' — stamped into priceSnapshot
  source: text('source').notNull().default('builtin'),
}, (t) => ({ modelEffectiveUq: uniqueIndex(...).on(t.provider, t.model, t.effectiveFrom) }));

export const workspaceModelPrices = pgTable('workspace_model_prices', {
  // same price shape + workspaceId FK + createdByUserId; uq(workspaceId, model, effectiveFrom)
});
```

**Seed data** (`packages/db/src/seed/model-prices.ts`, applied by `reqops seed-model-prices` and `reqops init`). Anthropic per-1M-token USD (cache read = 0.1× input; cache write 5m = 1.25× input):

| provider | model | input | output | cache read | cache write |
|---|---|---|---|---|---|
| anthropic | claude-fable-5 | 10.00 | 50.00 | 1.00 | 12.50 |
| anthropic | claude-opus-4-8 / 4-7 / 4-6 | 5.00 | 25.00 | 0.50 | 6.25 |
| anthropic | claude-sonnet-4-6 | 3.00 | 15.00 | 0.30 | 3.75 |
| anthropic | claude-haiku-4-5 | 1.00 | 5.00 | 0.10 | 1.25 |

OpenAI/Google/Mistral prices: **verify against provider pricing pages at implementation time** (they change often). Re-seeding a new catalog version closes superseded rows (`effectiveTo = now()`) rather than mutating — auditability of the catalog itself.

### 1c. Rollups — `usage_rollups_daily`

```ts
export const usageRollupsDaily = pgTable('usage_rollups_daily', {
  id: baseId(),
  workspaceId / agentId: uuid (notNull),
  model: text('model').notNull(),
  day: date('day').notNull(),                          // UTC day of occurredAt
  generationCount: integer, inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens: bigint,
  costUsd: numeric('cost_usd', { precision: 16, scale: 8 }).notNull().default('0'),
  unpricedCount: integer('unpriced_count').notNull().default(0),
}, (t) => ({ rollupUq: uniqueIndex(...).on(t.workspaceId, t.agentId, t.model, t.day) }));
```

**Compute strategy: incremental upsert at ingest**, in the same transaction as the `llm_generations` insert (`INSERT ... ON CONFLICT (workspace_id, agent_id, model, day) DO UPDATE SET ... + EXCLUDED...`). Ingest volume is modest (one row per LLM call, not per token); dashboards are always fresh with zero scheduler complexity. Escape hatch: `reqops rebuild-rollups` truncates and re-aggregates from `llm_generations`.

### 1d. Hash chain — columns on `audit_events`, per-workspace scope, advisory-lock serialization

**Extend `audit_events`** (`packages/db/src/schema/audit.ts`) rather than adding a side table: it is already the canonical append-only compliance log every service writes to; a separate chain table would be a second source of truth. `handoff_events` stays unchained (operational timeline; every compliance-relevant transition is also written to `audit_events`).

New columns:

```ts
seq: bigint('seq', { mode: 'number' }),   // per-workspace monotonic, 1-based
prevHash: text('prev_hash'),              // hex sha256; genesis: sha256('reqops:' + workspaceId)
hash: text('hash'),
// uniqueIndex('audit_events_workspace_seq_uq').on(t.workspaceId, t.seq)
```

**Write path** — single funnel `appendAuditEvent` in NEW `packages/core/src/audit/chain.ts`; all existing inline `audit()` helpers (tasks/integrations services) migrate to it:

```ts
export async function appendAuditEvent(db, evt: AuditEventInput): Promise<void> {
  await db.transaction(async (tx) => {
    // Per-workspace serialization across all processes sharing this Postgres.
    // xact lock auto-releases at COMMIT/ROLLBACK — no single-writer queue needed.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('reqops_audit'), hashtext(${evt.workspaceId}))`);
    const [tip] = await tx.execute(sql`
      SELECT seq, hash FROM audit_events
      WHERE workspace_id = ${evt.workspaceId} AND seq IS NOT NULL
      ORDER BY seq DESC LIMIT 1`);
    const seq = (tip?.seq ?? 0) + 1;
    const prevHash = tip?.hash ?? genesisHash(evt.workspaceId);
    const at = new Date();
    const hash = sha256Hex(canonicalJson({           // RFC 8785-style: sorted keys, no whitespace
      v: 1, workspaceId: evt.workspaceId, seq, prevHash,
      actorType: evt.actorType, actorId: evt.actorId, action: evt.action,
      targetType: evt.targetType, targetId: evt.targetId,
      payload: evt.payload, at: at.toISOString(),
    }));
    await tx.insert(auditEvents).values({ ...evt, seq, prevHash, hash, at });
  });
}
```

`verifyChain` re-walks `ORDER BY seq` recomputing hashes. Canonicalization is versioned (`v:1`). Pre-chain rows are backfilled in `seq`/`at` order by `reqops backfill-audit-chain` (TypeScript — one canonicalization implementation), auto-invoked at the end of `reqops migrate`.

### 1e. `agent_handoffs` additions

- `requeue_count smallint NOT NULL DEFAULT 0` — for "3 missed heartbeats → requeue; N requeues → failed".
- Index `agent_handoffs_reaper_idx ON (state, deadline_at)`.

**Migrations** (drizzle-kit, current head is `0001`): `0002` Phase 1 (handoff runtime columns), `0003` Phase 2 (steps/generations/prices/rollups), `0004` Phase 5 (audit chain columns).

---

## 2. Core services (`packages/core`)

Follow the existing pattern: function-style services taking `db: Database` first, DTO mappers, audit on every mutation (see `packages/core/src/tasks/service.ts`).

### 2a. `packages/core/src/handoffs/state-machine.ts`

Every transition is a single atomic `UPDATE ... WHERE <expected state> RETURNING`; 0 rows → typed `conflict()` error from `@reqops/shared`.

**Atomic claim** (the load-bearing query):

```sql
UPDATE agent_handoffs SET
  state = 'claimed', claim_token = gen_random_uuid(), claimed_at = now(),
  deadline_at = now() + ($3 * interval '1 minute'), updated_at = now()
WHERE id = (
  SELECT id FROM agent_handoffs
  WHERE actor_agent_id = $1 AND workspace_id = $2 AND state = 'queued'
    AND ($4::uuid IS NULL OR task_id = $4)
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` → two racing agents each get a different row or a clean miss; exactly one winner per handoff (claim-race test, architecture.md §13.11).

Other transitions (each appends `handoff_events` + chained `audit_events`, `actorType: 'agent'`):

- `heartbeat(db, claimToken, usage?)` — refresh `last_heartbeat_at` + `deadline_at`; `claimed → in_progress` on first heartbeat. Optional usage → `recordGeneration`.
- `complete(db, claimToken, { resultSummaryMd, usage? })` — target = `needs_review` when `review_required`, else `completed`.
- `fail(db, claimToken, reason, usage?)`.
- `requestReview(db, claimToken, summary)` — `in_progress → needs_review`.
- `review(db, workspaceId, userId, handoffId, decision, note?, rejectAction?: 'retry'|'fail')` — `needs_review → completed` (approved) or back to `in_progress` / `failed`.
- `reapExpired(db)` — worker job: `claimed|in_progress` rows with `deadline_at < now()` OR `last_heartbeat_at < now() - 180s`; `requeue_count < 3` → requeue (clear claim_token, increment counter); else `failed` with `failure_reason='heartbeat_timeout'`. Also `queued` past claim TTL (default 24h) → `cancelled`.

### 2b. `packages/core/src/agents/service.ts`

- `createAgent`, `listAgents` (with activity/cost summary joined from rollups), `getAgent`.
- `createApiKey(db, agentId, scopes)` → `reqops_agk_<8-char prefix>_<32-byte secret>`; Argon2id hash via `@node-rs/argon2`; plaintext returned exactly once.
- `verifyApiKey(db, rawKey)` → prefix lookup, argon2 verify, revocation check, throttled `last_used_at` touch. In-memory LRU (5 min TTL) so MCP/OTLP calls don't pay argon2 per request.
- Scopes: `tasks:read`, `tasks:write`, `handoffs:claim`, `handoffs:complete`, **`usage:write` (new)**.

### 2c. `packages/core/src/usage/`

`pricing.ts` — **price resolution order**:

```
resolvePrice(db, workspaceId, model, occurredAt):
  1. workspace_model_prices (workspace + model + effective-date window)  → 'workspace_override'
  2. model_prices exact model match (effective-dated)                    → 'catalog'
  3. model_prices match_pattern prefix match (longest pattern wins)      → 'catalog'
  4. none → 'unpriced', cost = null
costUsd = (input·inputPerM + output·outputPerM + cacheRead·cacheReadPerM + cacheWrite·cacheWritePerM) / 1_000_000
```

Every generation stores `priceSnapshot` (four resolved rates + catalogVersion) and `modelPriceId` → cost reproducible after catalog changes. Unknown models keep tokens, `costUsd = null`, surfaced as "Unpriced" badge + `unpricedCount` in rollups.

`service.ts` — `recordGeneration` (insert + rollup upsert in one tx), `recordStep` (next `seq` = `coalesce(max(seq),0)+1` under handoff row lock), `getHandoffUsageSummary`, `getWorkspaceSpend(groupBy: agent|model|day)`.

`otlp.ts` — pure mapper, OTLP JSON → `{ generations[], steps[] }` (see §4).

### 2d. `packages/core/src/handoffs/narrative.ts`

`narrateHandoff(handoff, agent, task, events, steps, generations)` → `{ headline, sentences[], summary }` — the plain-English strings used by web UI, PDF, and CSV alike, e.g.:

> "Agent 'claude-local' worked on 'Prepare Q2 report' for 14 minutes across 6 steps, used Claude Opus 4.8 (412,031 tokens in / 18,220 out), costing $1.87."

Keeping it in core guarantees every surface says the same thing.

---

## 3. MCP server (`apps/mcp` + `packages/mcp-sdk`)

`packages/mcp-sdk/src/index.ts`: full Zod input schemas shared by server (and future client SDKs). The nine tools from architecture.md §6 **plus two new tools**, plus an optional `usage` object on every lifecycle tool:

```ts
const usageInput = z.object({
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),       // self-reported, stored separately
}).optional();
// Semantics: each usage object is an INCREMENT since the previous report
// (one llm_generations row, source='mcp').
```

| Tool | Input (beyond claimToken) | Notes |
|---|---|---|
| `list_tasks` | filters | scope `tasks:read` |
| `get_task` | taskId | incl. comments + handoff history |
| `claim_task` | taskId? (omit = next queued) | returns claimToken, handoffId, deadline; scope `handoffs:claim` |
| `update_task` / `add_comment` | as today | scope `tasks:write` |
| `heartbeat` | `usage?` | refreshes deadline |
| **`log_step`** | `title` (only required field), `detail?`, `status?`, `usage?` | one narrative step |
| **`report_usage`** | `usage` (required), `stepTitle?` | per-LLM-call reporting; stepTitle creates/links a step |
| `request_review` | `summary` | |
| `complete_task` | `resultSummaryMd`, `usage?` | terminal (or needs_review) |
| `fail_task` | `reason`, `usage?` | terminal |

Philosophy: an agent that only calls `claim_task → heartbeat → complete_task` still works and still gets a coarse activity report from `handoff_events`; all usage reporting is additive. Tool descriptions tell agents *when* to call ("Call report_usage after each LLM API call, passing the usage block from the provider's response").

Files:
- `apps/mcp/src/server.ts` — `McpServer` (`@modelcontextprotocol/sdk`), registers tools from `@reqops/mcp-sdk`, delegates to `@reqops/core` in-process.
- `apps/mcp/src/index.ts` — replaces placeholder: stdio transport (`--stdio` / `REQOPS_MCP_TRANSPORT=stdio`) or streamable HTTP on port 7777.
- `apps/mcp/src/auth.ts` — stdio: key from `REQOPS_API_KEY` env; HTTP: `Authorization: Bearer reqops_agk_...` per request. Every tool call → `appendAuditEvent` (`actorType: 'agent'`).
- `apps/mcp/src/resources.ts` — the three `reqops://` resources from §6.
- `apps/mcp/package.json` — add `@reqops/core`, `@reqops/db` workspace deps.

---

## 4. OTLP ingest

**Location: `apps/api`** (`apps/api/src/routes/otlp.ts`, mounted at `/v1/otlp`) — API already terminates external HTTP and has DB access; MCP stays a thin tool server; hosted `cloud/mcp-gateway` can front this path later.

- `POST /v1/otlp/v1/traces` — standard OTLP/HTTP path, so agents just set
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4000/v1/otlp` and
  `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer reqops_agk_...`.
- **Auth**: agent API key via new middleware `apps/api/src/middleware/agent-key.ts`, scope `usage:write`.
- **v1 = OTLP JSON only**; protobuf → `415` with hint to set `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` (supported by OpenLLMetry, Langfuse SDK, OTel JS/Python). No protobuf toolchain in v1.
- **Mapping** (`packages/core/src/usage/otlp.ts`, per OTel GenAI semconv):
  - Span = **generation** iff it has `gen_ai.usage.input_tokens` / `output_tokens` (or legacy `prompt_tokens`/`completion_tokens`). model = `gen_ai.response.model` ?? `gen_ai.request.model`; provider = `gen_ai.system` / `gen_ai.provider.name`; cache tokens from `gen_ai.usage.cache_read_input_tokens` / `cache_creation_input_tokens`; `occurredAt` = span end; store trace/span ids.
  - Span = **step** iff it carries `reqops.step.title`, or is a trace root with a non-genai name (title = span name).
  - Everything else (HTTP/DB/internal spans) **ignored** — no full trace storage in v1.
  - **Correlation**, first match wins: attr `reqops.handoff_id` → attr `reqops.claim_token` → fallback: agent's single currently-claimed handoff if exactly one active. Uncorrelatable spans counted in the response body, not stored.
  - **Dedupe**: partial unique `(handoff_id, otel_span_id)`; re-exported batches no-op via `ON CONFLICT DO NOTHING`.
- **Double-counting rule**: summary queries exclude `source='mcp'` rows for any handoff that also has `source='otlp'` rows (OTLP strictly more granular). Documented in tool descriptions: "if your agent exports OTel traces, you do not need report_usage."

---

## 5. REST API (`apps/api`)

New routers mounted in `apps/api/src/app.ts`; session-auth + `requireMembership` unless noted:

| File | Endpoints |
|---|---|
| `src/routes/agents.ts` | `GET/POST /v1/agents` · `GET /v1/agents/:id` (with 30-day cost/activity) · `POST /v1/agents/:id/keys` (plaintext once) · `DELETE /v1/agents/:id/keys/:keyId` |
| `src/routes/handoffs.ts` | `POST /v1/tasks/:id/handoff` (body: agentId, reviewRequired?, deadlineMinutes?) · `GET /v1/handoffs?workspaceId&state&agentId&taskId` · `GET /v1/handoffs/:id` (events + steps + generations + narrative + usage summary) · `POST /v1/handoffs/:id/review` ({decision, note?, rejectAction?}) · `POST /v1/handoffs/:id/cancel` |
| `src/routes/usage.ts` | `GET /v1/usage/summary?workspaceId&from&to&groupBy=agent\|model\|day` · `GET /v1/model-prices?workspaceId` (catalog + overrides merged) · `PUT /v1/model-prices/overrides` (admin) |
| `src/routes/otlp.ts` | `POST /v1/otlp/v1/traces` (agent-key auth) |
| `src/routes/audit.ts` | `GET /v1/audit/verify?workspaceId` → `{valid, checkedCount, headSeq, headHash, firstBrokenSeq?}` · `GET /v1/audit/events?workspaceId&from&to` (paginated) |
| `src/routes/exports.ts` | see §7 |

`POST /v1/tasks/:id/handoff` also enqueues `handoff.notify_agent` (no-op dispatcher in v1 except `kind='paperclip'` adapter hook).

---

## 6. Queue + worker

`packages/queue/src/index.ts`:

```ts
export const HANDOFF_JOBS = {
  reapExpired: 'handoff.reap_expired',
  notifyAgent: 'handoff.notify_agent',
  dispatch: 'handoff.dispatch',
} as const;
export function createHandoffQueue(connection) { /* Queue(QUEUE_NAMES.handoff) */ }
export async function scheduleReaper(queue) {
  await queue.upsertJobScheduler('handoff-reaper', { every: 30_000 },
    { name: HANDOFF_JOBS.reapExpired, data: {} });
}
```

`apps/worker/src/handoffs.ts` — handlers (`runReapExpired` → `reapExpired`); `apps/worker/src/index.ts` adds a second `Worker` on the `handoff` queue + `scheduleReaper` at boot (mirrors existing `reconcilePolling` pattern).

---

## 7. Web UI (business-friendly)

Nav in `apps/web/src/components/app-shell.tsx` gains **Agents** and **Reviews**. All copy non-technical: "handoff" renders as **"Agent task"**; states render as *Waiting for agent / Agent working / Needs your review / Done / Didn't finish*.

| Route | Content |
|---|---|
| `agents/page.tsx` | Agent directory — card per agent: name, kind badge, "worked on N tasks this month", "spent $X this month", last active. "Add agent" dialog creates agent + first key, shows key + ready-to-paste MCP config snippet once. |
| `agents/[agentId]/page.tsx` | Summary cards (tasks done, time worked, total cost, tokens) · recent agent tasks · key management · spend sparkline. |
| `agents/spend/page.tsx` | **Agent Spend dashboard**: month-to-date cost card · stacked bar chart cost-by-day (group by agent/model toggle) · table by model with "Unpriced" badge rows · CSV export. Charts via shadcn chart components (recharts) added to `packages/ui`. |
| `handoffs/[handoffId]/page.tsx` | **Activity Report** — headline narrative sentence · summary cards (Duration, Models used, Tokens, Cost — with "includes unpriced calls" badge when applicable) · plain-English vertical timeline (claimed → steps → review → completed) from `narrative.sentences` + steps · review gate panel (Approve / Send back with note) when `needs_review` · Download PDF / CSV buttons · "Integrity verified ✓" sourced from verify endpoint. |
| `reviews/page.tsx` | Review queue — all `needs_review` handoffs, inline approve/reject. |

Components (`apps/web/src/components/`): `handoff-panel.tsx` (embedded in `task-detail-sheet.tsx` — "Hand off to agent" button, agent picker, status chip + mini-timeline + link to full report), `agent-picker-dialog.tsx`, `handoff-timeline.tsx`, `usage-summary-cards.tsx`, `spend-chart.tsx`, `agent-key-reveal.tsx`. Extend `apps/web/src/lib/api.ts`; friendly state labels in `apps/web/src/lib/handoff-meta.ts`.

---

## 8. Exports & verification

**PDF: `@react-pdf/renderer`, server-side in `apps/api`** (`renderToBuffer`). Pure JS — no headless Chrome bloating the OSS docker image; the report is structured text/tables. Document component `apps/api/src/pdf/handoff-report.tsx`; reuses `narrateHandoff` so PDF matches UI verbatim. Contents: header (workspace/task/agent/dates), narrative summary, step timeline table, model/token/cost table with price-snapshot footnote ("Priced using catalog version 2026-06-10.1; rows marked * use workspace override"), integrity block (chain head hash + verification timestamp).

Endpoints (`apps/api/src/routes/exports.ts`):
- `GET /v1/handoffs/:id/report.pdf`
- `GET /v1/handoffs/:id/activity.csv` — steps + generations flat
- `GET /v1/usage/export.csv?workspaceId&from&to` — rollups
- `GET /v1/audit/package?workspaceId&from&to` — **audit package** zip (`archiver`): `audit-events.jsonl` (chained rows incl. seq/prev_hash/hash) · `usage.csv` · `verification.json` (fresh chain walk + catalog version) · `README.txt` documenting the hash recipe so an auditor can independently re-verify.

**Verification CLI**: `apps/cli/src/commands/verify-audit.ts` → `reqops verify-audit --workspace <slug>`; runs `verifyChain` from core, non-zero exit on break. Same function backs `GET /v1/audit/verify`.

**OSS vs cloud**: everything above is OSS (Apache). `cloud/audit-export` (BSL): scheduled/continuous export to customer S3/Datadog (`audit.export_batch` job), retention policies, org-wide cross-workspace packages. `cloud/mcp-gateway` later fronts OTLP with per-tenant rate limits. Nothing in OSS imports from `cloud/*`.

---

## 9. CLI (`apps/cli/src/commands/`)

- `create-agent.ts` / `create-agent-key.ts` — replace M5 stubs; key command prints key once + Claude Desktop/Claude Code MCP config snippet (architecture.md §13.6).
- `seed-model-prices.ts` — idempotent catalog seed/upgrade (closes superseded rows).
- `verify-audit.ts` · `backfill-audit-chain.ts` (auto-run by `migrate.ts` after `0004`) · `rebuild-rollups.ts`.

---

## 10. Phase plan

### Phase 1 — M5 runtime (handoffs + agents + MCP + basic UI)
Migration `0002`; handoffs state-machine + agents service; handoff queue + worker reaper; REST `agents.ts` + `handoffs.ts`; MCP server with original 9 tools (stdio + HTTP); CLI create-agent/-key; `handoff-panel` in task sheet + `reviews` page.
**Verify**: Testcontainers — claim race (two concurrent claims, exactly one wins), heartbeat-timeout requeue, review gate. Manual e2e: create agent via CLI → configure Claude Code against local MCP → hand off task in UI → watch `queued → claimed → in_progress → completed` in timeline → confirm `audit_events` for every tool call.

### Phase 2 — Usage ledger + cost engine
Migration `0003`; pricing + usage services; seed catalog; MCP `log_step`/`report_usage` + `usage` on lifecycle tools; usage REST.
**Verify**: unit tests for price resolution (override beats catalog; effective dating; pattern match; unknown → null) and cost math vs hand-computed values. Integration: `report_usage` → generation row with correct snapshot + rollup increment; `rebuild-rollups` reproduces identical totals.

### Phase 3 — OTLP ingest
Mapper + route + agent-key middleware.
**Verify**: fixture OTLP JSON (OpenLLMetry-shaped, Langfuse-SDK-shaped, legacy token attr names) maps correctly; dedupe on re-POST; live test with instrumented script (`OTEL_EXPORTER_OTLP_PROTOCOL=http/json`) against a claimed handoff; mcp-source rows excluded from summary when otlp rows exist.

### Phase 4 — Business UI
Agents directory, agent detail, spend dashboard, Activity Report, narrative module.
**Verify**: seeded demo workspace renders all pages; spend dashboard totals equal `usage/summary` API; narrative snapshot tests.

### Phase 5 — Hash chain
Migration `0004`; `appendAuditEvent` funnel (migrate all existing `audit()` call sites); backfill; verify endpoint + CLI.
**Verify**: 50 parallel writers across 2 workspaces → gapless per-workspace sequences + valid chain. Tamper test: `UPDATE audit_events SET payload=... WHERE seq=K` in psql → verify reports `firstBrokenSeq=K`. Backfill on populated DB verifies clean.

### Phase 6 — Exports + audit package
react-pdf report, CSV endpoints, audit package zip, UI download buttons; `cloud/audit-export` README updated with scheduled-export design.
**Verify**: PDF golden-file smoke (renders; contains narrative + cost + catalog version); CSV row counts match DB; audit package `verification.json` validates and the documented hash recipe re-verifies `audit-events.jsonl` with a standalone script.

---

## Critical files (implementation order)

1. `packages/core/src/handoffs/state-machine.ts` — atomic claim/heartbeat/complete/review/reap; the heart of M5
2. `packages/db/src/schema/usage.ts` (new) + extensions to `schema/handoffs.ts`, `schema/audit.ts`
3. `packages/core/src/usage/pricing.ts` — price resolution + cost snapshot (the reproducibility contract)
4. `apps/mcp/src/server.ts` — MCP tool registration over `@reqops/core`, replacing the placeholder
5. `packages/core/src/audit/chain.ts` — hash-chained `appendAuditEvent` + `verifyChain`, funnel for all audit writes

## Patterns to mirror (existing code)

- `packages/core/src/tasks/service.ts` — service shape + audit logging
- `apps/api/src/routes/tasks.ts` — Hono + Zod route shape
- `apps/worker/src/sync.ts` + `apps/worker/src/index.ts` — job handler + worker boot
- `packages/queue/src/index.ts` — queue/job registry
- `apps/web/src/components/task-detail-sheet.tsx` — detail drawer (handoff timeline placeholder lives here)
