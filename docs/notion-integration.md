# ReqOps — Notion Integration Plan

Status: **planned** (next integration after M5 Phase 3 / OTLP). Two tracks, built in
order: **(A) task sync** (like the existing Asana connector) and **(B) agent
visibility** (surface ReqOps agent activity into Notion). Companion to
`docs/architecture.md` and `docs/agent-tasks-and-auditability.md`.

This plan is grounded in a review of the live Notion developer docs (June 2026).
The two facts that shape everything:

1. **Databases were split into databases + data sources** in API version
   `2025-09-03`. A database is now a *container* for one or more **data sources**,
   each with its own schema. Most operations that took a `database_id` now take a
   `data_source_id`. Integrations pinned to the old `2022-06-28` query endpoint
   **break** the moment a user adds a second data source (create-page, query, and
   relation writes all fail, ungracefully). → We target `2025-09-03` from day one.
2. **Notion 3.5 (2026-05-13)** shipped an **External Agents API** (private beta)
   that lets third-party agents (Claude, Codex, …) operate natively in Notion —
   chat, assignment, progress tracking. Strategic fit for Track B, but alpha +
   waitlist, so it is a "watch / join waitlist" item, not the v1 path.

---

## Notion API facts that matter (verified against live docs)

- **Auth**: OAuth 2.0 for a distributable (public) connection — redirect → temporary
  `code` → `POST /v1/oauth/token` exchange for a bearer `access_token`. An
  **internal integration token** works for a single workspace (simplest for staging
  testing). 3.5 added workspace-scoped OAuth + personal access tokens, and now any
  workspace *member* (not just owners) can build connections. Either way the user
  must explicitly **share the specific database/page** with the connection — it
  cannot see the whole workspace.
- **Version header**: send `Notion-Version: 2025-09-03` on every request.
- **Data-source discovery**: `GET /v1/databases/{database_id}` returns a
  `data_sources: [{ id, name }]` array. Single-source DBs (today's norm) return one.
  Store the `data_source_id`; it is *not* interchangeable with `database_id`.
- **Query**: `PATCH /v1/data_sources/{data_source_id}/query` (filters/sorts), paginated
  via `start_cursor` / `has_more` / `next_cursor`.
- **Pages (task CRUD)**: `POST /v1/pages` with parent
  `{ "type": "data_source_id", "data_source_id": "…" }`; `PATCH /v1/pages/{id}` to
  update properties; `GET /v1/pages/{id}` to retrieve. Relation writes must use
  `data_source_id` (no longer `database_id`).
- **Discovery of shared content**: `POST /v1/search` to list databases/pages the
  connection can see (drives the "pick a database" UI).
- **Writing rich content** (Track B): `PATCH /v1/blocks/{block_id}/children`, **max
  100 blocks/request**, **2 nesting levels** per request, `position: {type: end|start|after_block}`.
  Block types cover headings, paragraphs, tables, callouts, code, dividers, toggles,
  to-dos — enough to render an Activity Report natively.
- **Webhooks** (mirrors our Asana pattern closely):
  - Create a subscription → Notion sends a one-time POST with a `verification_token`
    (`secret_…`); we persist it and the user pastes it into the Notion UI to verify.
  - Every event carries `X-Notion-Signature: sha256=<hex>` = HMAC-SHA256 of the
    **minified** body keyed by the `verification_token`; verify with a timing-safe
    compare (we already do exactly this for Asana's `X-Hook-Signature`).
  - Event types incl. `page.content_updated` (**aggregated/batched** — payload gives
    `entity.id`, so re-fetch the page rather than trust the body),
    `data_source.schema_updated` (`2025-09-03`+), `comment.created` (needs the comment
    capability), `page.locked`. Events only fire for objects the connection can access.
- **Rate limits**: average **3 requests/second** per connection, bursts allowed;
  `429` (`rate_limited`) and `529` responses carry `Retry-After` (seconds) — honor it.
  Backfills must throttle. Fits our scale-to-zero / cost-minimal posture.
- **Notion-hosted alternatives (3.5, watch — don't depend)**: **Data Sync (beta)** can
  pull from any API into Notion DBs, and **Workers** run hosted code for sync/agent
  tools/webhook triggers. Both are Notion-hosted, beta, and start consuming Notion
  credits Aug 11 2026 — they invert control and don't fit an OSS/self-host story, so
  we build our own connector and treat these as competitive context.

---

## Track A — Notion as a task source

Mirror `packages/connectors/asana`. The one genuinely new piece vs Asana is
**field mapping**: Notion task databases are user-defined, so "Status", "Assignee",
"Due date" are conventions, not guaranteed fields. Each connection needs a stored
mapping from Notion properties → ReqOps task fields.

### Files (mirroring the Asana connector)
- `packages/connectors/notion/src/index.ts` — API client: OAuth token exchange,
  `search`, data-source discovery + query (paginated), pages create/update/retrieve,
  block append (for Track B). A **rate-limit wrapper** (token bucket at 3 req/s +
  `429`/`529` `Retry-After` backoff). A `page ↔ task` mapper parameterized by the
  stored field mapping. Plus `packages/testing/src/fake-notion.ts` for tests.
- `packages/shared/src/integration.ts` — add `'notion'` provider; config schema
  carrying `databaseId`, resolved `dataSourceId`, and the property field-map.
- `packages/db/src/schema/integrations.ts` — persist `dataSourceId`, field-map JSON,
  and the webhook `verification_token` (encrypted, like Asana's hook secret).
- `apps/api/src/connectors.ts` + `routes/oauth.ts` — Notion OAuth connect/callback.
- `apps/api/src/routes/webhooks.ts` — `POST /webhooks/notion/:integrationId`:
  verification handshake + `X-Notion-Signature` HMAC verify + enqueue a sync job
  (reuse the Asana receiver's shape).
- `apps/worker/src/adapters.ts` + sync handler — backfill + incremental sync jobs.
- `apps/web` — connect flow, **field-mapping UI**, sync status.

### Phasing
- **N1** — OAuth/connect + data-source discovery + **read-only backfill**
  (Notion → ReqOps tasks) with field mapping. *Verify on staging*: connect an
  internal-token integration to a test DB, map fields, confirm tasks upsert.
  - **Started 2026-06-14.** Done so far: `packages/connectors/notion` (client pinned to
    `Notion-Version: 2025-09-03`, 3 req/s serial rate-limiter + `Retry-After` backoff,
    `verifyToken` / `discoverDataSources` / `queryDataSource` paginated + incremental,
    `pageToTask` mapper driven by a stored `NotionFieldMap`, and `notionAdapter` with
    `pull()` + OAuth `buildAuthUrl`/`exchangeCode` for later public OAuth; `pollOnly: true`
    until N2). `notion` registered in shared `integrationProvider`/`externalSystem` zod
    enums + both DB `pgEnum`s; new `integrations.config` jsonb column (stores
    `{ dataSourceId, fieldMap }`); `PullContext.config` added and wired through
    `worker/sync.ts runPull`; adapter registered in `apps/worker` + `apps/api` connector
    maps (`oauthConfigFor` maps made `Partial` — Notion has no OAuth client). **Migration
    `0004_yummy_tag.sql`** (enum ADD VALUE + config column; safe in-txn on PG14). Whole repo
    typechecks. **Still TODO for N1**: token-connect API route (`POST` pasted internal token →
    `verifyToken` → `discoverDataSources` → store encrypted token + resolved `dataSourceId` +
    field map; reuse `oauth_access_token_enc`), a data-source/property discovery endpoint to
    drive the field-map UI, the web connect + field-mapping UI, `packages/testing/fake-notion.ts`
    + adapter/mapper tests, and a staging migrate+deploy to apply `0004`.
  - **Note:** plan §1d's audit-chain migration (was pencilled in as `0004`) becomes `0005+`.
- **N2** — **Webhook incremental sync**: handshake, HMAC verify, re-fetch on
  `page.content_updated` (treat as batched), handle `data_source.schema_updated`.
- **N3** — **Outbound writes** (ReqOps → Notion): `PATCH /v1/pages/{id}` on task
  change; create under `data_source_id`.

---

## Track B — Notion as an agent-visibility destination

Goal: put ReqOps agent activity where business users already are. Two options,
escalating in ambition and in API maturity.

### B1 — Push Activity Reports to Notion (build on stable API)
When a handoff completes (or on demand), render its **narrative + step timeline +
token/cost table + integrity block** into Notion blocks and either create a page
under a configured "Agent Activity" data source or append to an existing page.
- **Reuse `narrateHandoff` + `priceSnapshot`** (the same source the PDF/CSV exports
  use) so the Notion report matches the UI verbatim — this is the Phase 6 export
  surface pointed at Notion instead of PDF/zip.
- Map summary cards → callouts, step timeline → numbered list/table, cost table →
  a Notion table block. Chunk to ≤100 blocks/request.
- Drive it from a `notion.export_activity` queue job (or the existing
  `handoff.notify_agent`/dispatch hook). Optionally also upsert a daily "Agent Spend"
  row from `usage_rollups_daily`.
- Available today, OSS-friendly, no waitlist. **This is the v1 of Track B.**

### B2 — External Agents API (alpha; join waitlist now)
Register ReqOps agents as Notion **External Agents** so they appear natively —
assignable from Notion, progress tracked, chat-able. This is the strategic endgame
("Notion as the AI layer") but it is **private beta / waitlisted** and the surface is
not yet stable. Action: **join the External Agents waitlist now**, and design B1's
handoff→report data flow so it can later feed B2's progress-tracking without rework.
Do not block B1 on B2.

---

## Cross-cutting decisions

- **Pin `Notion-Version: 2025-09-03`** everywhere (non-negotiable — avoids the
  data-source breaking change).
- **Auth for staging**: start with an **internal integration token** (single
  workspace) to validate end-to-end on Fly staging; add public OAuth for multi-tenant
  cloud later.
- **Rate limiting**: a shared 3 req/s throttle + `Retry-After` backoff in the client,
  used by both backfill and Track B writes.
- **Webhook verification** is a manual paste step (like the Asana handshake) — surface
  it in the connect UI with copy explaining the one-time token.
- **OSS vs cloud**: connector + Track B1 are OSS; any reliance on Notion Workers/Data
  Sync, or the hosted External Agents path, would be cloud-tier and is out of scope
  for the OSS build.

---

## Sources (live docs, reviewed June 2026)
- Upgrade guide — data sources vs databases (`2025-09-03`): https://developers.notion.com/docs/upgrade-guide-2025-09-03
- Query a data source: https://developers.notion.com/reference/query-a-data-source
- Webhooks reference (verification, signature, event types): https://developers.notion.com/reference/webhooks
- Authorization (OAuth) & Request limits: https://developers.notion.com/docs/authorization · https://developers.notion.com/reference/request-limits
- Append block children: https://developers.notion.com/reference/patch-block-children
- Notion Developer Platform 3.5 release (External Agents API, Workers, Data Sync, bidirectional webhooks): https://www.notion.com/releases/2026-05-13
- Introducing Notion's Developer Platform: https://www.notion.com/blog/introducing-developer-platform
