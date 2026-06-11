# ReqOps — Draft Architecture & MVP Implementation Plan

## Context

**Problem.** Business teams in the agentic era have work scattered across SaaS task systems (Microsoft To Do / Planner, Google Tasks, Asana, Linear, Jira, GitHub, Slack, etc.). They also increasingly want to hand individual items off to autonomous agents — but there is no clean place where the *human task graph* and the *agent task graph* meet. Existing tools each pick a side:

- **Linear / Asana / MS Planner** — strong human surfaces, weak/closed agent story, no cross-tool aggregation.
- **Paperclip** (paperclipai/paperclip, MIT, TS, Postgres) — strong agent control plane: hierarchical issues, agent budgets, heartbeats, governance. But **no OAuth connectors, no MCP server, no SaaS integration framework, no team/inbox UX**. Their docs explicitly disclaim chat UX, code review, mobile, and enterprise identity.

**Opportunity.** Build the connector + team layer that Paperclip refuses to be: an OAuth-backed task aggregation hub with a unified human/agent inbox, an MCP surface that any agent (Paperclip, Claude, Cursor, custom) can consume, multi-tenant cloud, and a clean self-hostable OSS core.

**Intended outcome.** A v0.1 that a small team can `docker compose up` in 60s, OAuth into Google Tasks + Asana + MS To Do/Planner, see a unified inbox, hand a task to an agent via the UI, and have an MCP-capable agent claim → progress → complete it round-trip back to the originating SaaS.

**Locked decisions** (from clarifying questions): TypeScript end-to-end (Node 20 + Next.js); plain Postgres + portable auth (Better-Auth); MCP-first / BYO agent; v1 integrations = Microsoft To Do + Microsoft Planner + Google Tasks + Asana.

---

## 1. Guiding principles

- **Boring, portable stack** — plain Postgres + Redis, no cloud lock-in, every component runs in a container.
- **Same code, two SKUs** — OSS self-host = single-tenant defaults; hosted SaaS = same containers + extra `cloud/*` packages mounted in. "Every-feature-but-X" split (à la GitLab CE/EE, Sentry), not feature flags lying about availability.
- **MCP is the agent contract** — ReqOps is the source of truth for tasks; agents are clients. No bespoke agent runtime in v1.
- **Adapter pattern everywhere** — connectors, agent platforms, auth providers, object store all sit behind typed interfaces so OSS users can swap implementations.

---

## 2. Monorepo layout (pnpm workspaces + Turborepo)

```
reqops/
├── package.json                       # pnpm workspace root, turbo pipeline
├── pnpm-workspace.yaml
├── turbo.json
├── docker-compose.yml                 # OSS one-shot bootstrap
├── docker-compose.dev.yml             # local dev (just postgres + redis)
├── .env.example
│
├── apps/
│   ├── web/                           # Next.js 15 App Router — UI + auth pages
│   ├── api/                           # Hono API server (HTTP + webhooks)
│   ├── worker/                        # BullMQ worker process (sync, handoff dispatch)
│   ├── mcp/                           # MCP server (stdio + streamable HTTP transport)
│   └── cli/                           # `reqops` CLI — bootstrap, migrate, seed, doctor
│
├── packages/
│   ├── db/                            # Drizzle schema, migrations, query helpers
│   ├── core/                          # Domain services: tasks, handoffs, orgs, memberships
│   ├── auth/                          # Better-Auth config + adapters (shared by web + api)
│   ├── shared/                        # Zod schemas, DTOs, error types, constants
│   ├── ui/                            # React component library (shadcn/ui-based)
│   ├── config/                        # Env loader (Zod-validated), feature flags
│   ├── queue/                         # BullMQ wrappers, job type registry
│   ├── mcp-sdk/                       # Internal MCP tool/resource defs (shared by apps/mcp)
│   │
│   ├── connectors/
│   │   ├── core/                      # ConnectorAdapter interface, OAuth helpers, sync runner
│   │   ├── google-tasks/
│   │   ├── microsoft-todo/
│   │   ├── microsoft-planner/
│   │   └── asana/
│   │
│   ├── agent-adapters/
│   │   ├── core/                      # AgentAdapter interface
│   │   └── paperclip/                 # Paperclip bridge (heartbeat translation)
│   │
│   └── testing/                       # Fixtures, fake OAuth servers, in-memory queue
│
└── cloud/                             # BSL 1.1; only built on hosted
    ├── billing/                       # Stripe
    ├── sso-saml/
    ├── audit-export/
    └── mcp-gateway/                   # Multi-tenant MCP edge
```

**Why pnpm + Turbo**: pnpm gives strict per-package isolation (catches missing deps); Turbo caches typecheck/test/build across the graph.

---

## 3. Core data model (Drizzle + Postgres)

All tables get `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`. Tenant-scoped tables carry `workspace_id` with a composite index.

```
organizations            (id, name, slug uq, billing_customer_id null)
workspaces               (id, organization_id fk, name, slug uq-per-org)
users                    (id, email uq, name, image_url, is_system bool)
memberships              (id, workspace_id, user_id, role enum[owner|admin|member|viewer],
                          uq(workspace_id, user_id))
sessions / accounts      (Better-Auth managed)

tasks                    (id, workspace_id, title, description_md, status enum,
                          priority smallint, due_at, assignee_user_id null,
                          parent_task_id null, source_of_truth enum[reqops|external],
                          external_canonical_id null, last_synced_at, etag text,
                          search_tsv tsvector generated)
task_sources             (id, task_id fk, integration_id fk,
                          external_system enum[google_tasks|ms_todo|ms_planner|asana|reqops],
                          external_id text, external_url, external_etag text,
                          external_updated_at,
                          idempotency_key text,                   -- sha256(system|integration|external_id)
                          uq(external_system, external_id, integration_id))
task_assignments         (id, task_id, assignee_type enum[user|agent], assignee_id,
                          assigned_by_user_id, assigned_at, unassigned_at null)
agent_handoffs           (id, task_id, workspace_id, actor_agent_id fk,
                          state enum[queued|claimed|in_progress|needs_review|completed|failed|cancelled],
                          claim_token uuid uq,
                          claimed_at, last_heartbeat_at, deadline_at,
                          result_summary_md, failure_reason,
                          requested_by_user_id,
                          review_required bool,
                          reviewed_by_user_id, reviewed_at,
                          review_decision enum[approved|rejected] null)
handoff_events           (id, handoff_id, kind, payload jsonb, at)  -- append-only audit
agents                   (id, workspace_id, name,
                          kind enum[mcp_generic|paperclip|claude_code|custom],
                          public_key_fingerprint null, metadata jsonb)
agent_api_keys           (id, agent_id, prefix text, hash text, scopes text[],
                          last_used_at, revoked_at null)
integrations             (id, workspace_id, provider enum, account_label,
                          oauth_access_token_enc bytea, oauth_refresh_token_enc bytea,
                          oauth_expires_at, scopes text[], external_account_id,
                          webhook_subscription_id null, webhook_expires_at null,
                          status enum[active|degraded|revoked], last_sync_at)
sync_cursors             (integration_id, resource text, cursor text, updated_at,
                          pk(integration_id, resource))           -- delta tokens
webhook_deliveries       (id, integration_id, provider, signature, payload_hash,
                          received_at, processed_at null, status,
                          uq(provider, payload_hash))
audit_events             (id, workspace_id, actor_type, actor_id, action,
                          target_type, target_id, payload jsonb, at)
```

### Sync keys & dedup

- **External → ReqOps** dedupe: `task_sources(external_system, external_id, integration_id)` UNIQUE. The `idempotency_key = sha256(system|integration_id|external_id)` is used as the BullMQ `jobId` so re-deliveries collapse.
- **One ReqOps task ↔ N `task_sources`** — a single inbox row can mirror "the same task" across Asana + MS Planner (manual merge in v1).
- **Webhook idempotency**: `webhook_deliveries(provider, sha256(raw_body))` UNIQUE.
- **`etag` / `external_etag`**: conditional reads (Google Tasks ETags, MS Graph delta tokens).

---

## 4. Sync architecture

```
External SaaS ──webhook──► apps/api /webhooks/:provider ──► enqueue(sync.process_event)
                                                                  │
External SaaS ◄──poll──── apps/worker (cron per integration) ─────┤
                                                                  ▼
                                                            BullMQ queue
                                                                  │
                                                                  ▼
                                                       ConnectorAdapter.pull/push
                                                                  │
                                                                  ▼
                                                          packages/core/tasks
                                                          (upsert by sync key)
```

### Per-connector strategy

| Provider | Inbound | Outbound | Notes |
|---|---|---|---|
| Asana | Webhooks (Events API) | REST | `X-Hook-Secret` handshake; subscriptions decay on inactivity — worker refreshes weekly. |
| MS To Do / Planner | Graph change notifications (subscriptions, max ~3 days) | Graph REST | Worker auto-renews every 24h; delta query for backfill. |
| Google Tasks | **No webhooks** — poll every 60s using `tasks.list?updatedMin=` + cursor. | REST | Backoff to 5min when integration idle >30min. |

### Conflict resolution

Per-task `source_of_truth` field. Default: **external system wins for fields it owns** (title, status mapping, due date); **ReqOps wins for fields only it has** (handoff state, internal comments, agent assignments). Tiebreak by comparing `external_updated_at` vs `tasks.updated_at`. Conflicts logged to `audit_events` as `task.sync_conflict`.

Sync jobs are sharded by `integration_id` (BullMQ jobId prefix) so a single integration is processed in order. Worker scales horizontally otherwise.

---

## 5. Agent handoff lifecycle

State machine on `agent_handoffs.state`:

```
                                claim_task(claim_token)         heartbeat / progress
   request_handoff()
   ─────────────────► queued ───────────────────► claimed ──────────────────► in_progress
                        │                            │                            │
                        │ TTL expires (no claim)     │ heartbeat gap              │
                        ▼                            ▼                            │
                     cancelled                    failed (reclaimable)            │
                                                                                  │
                ┌──────────── request_review() ──────────────────────────────────┘
                ▼
         needs_review ──── approve ──► completed
                │
                └──── reject ──► in_progress (re-loop) or failed

   complete_task() (no review required) ──────────────────────► completed
   fail(reason) ────────────────────────────────────────────────► failed
```

Rules:
- **Single-claimer**: `claim_task` is `UPDATE ... WHERE state='queued' RETURNING` — atomic. Returns a `claim_token` required on every subsequent call.
- **Deadlines**: every claim has `deadline_at`. Cron job moves expired in-progress handoffs back to `queued` (or `failed` after N retries).
- **Heartbeat**: agents post `last_heartbeat_at` every ≤60s while `in_progress`. 3 missed heartbeats → re-queue.
- **Review gate**: when `review_required=true` (workspace policy or per-handoff), `complete_task` transitions to `needs_review` instead.

### Paperclip integration

`packages/agent-adapters/paperclip` translates ReqOps task ↔ Paperclip issue (budget hints from `priority`/`due_at`), listens for Paperclip heartbeats via webhook, maps terminal states. Configured per workspace as another `agents` row with `kind='paperclip'` + Paperclip API base URL + key.

---

## 6. MCP server design (`apps/mcp`)

Standalone process exposing both **stdio transport** (Claude Desktop, Cursor, local agents) and **streamable HTTP** (remote agents, hosted MCP gateway). Thin client of `packages/core` — in-process when colocated, HTTP to `apps/api` when separate (`REQOPS_API_URL`).

**Resources**
- `reqops://workspaces/{wsId}/tasks` — list, filterable via URI params
- `reqops://workspaces/{wsId}/tasks/{taskId}` — single task
- `reqops://workspaces/{wsId}/handoffs/queued` — claimable queue

**Tools**

| Tool | Purpose |
|---|---|
| `list_tasks` | filter by status, assignee, label, due window |
| `get_task` | full task + comments + handoff history |
| `claim_task` | atomic claim → returns `claim_token` |
| `update_task` | mutate title/desc/status (subject to source_of_truth) |
| `add_comment` | append internal comment |
| `heartbeat` | refresh deadline on in-progress claim |
| `request_review` | move to `needs_review` |
| `complete_task` | terminal success |
| `fail_task` | terminal failure with reason |

**Auth model**: per-workspace `agents` row → 1..N `agent_api_keys`. Key format `reqops_agk_<prefix>_<secret>` (prefix indexed, secret Argon2id hashed). Scopes: `tasks:read`, `tasks:write`, `handoffs:claim`, `handoffs:complete`. Every tool call → `audit_events` with `actor_type='agent'`.

---

## 7. Open-core vs hosted split

### OSS core — Apache 2.0
Web app, API, worker, MCP server, all 4 v1 connectors, all agent adapters, multi-workspace within one Postgres, Better-Auth (email/password + Google/GitHub/Microsoft OAuth), webhook receivers, DB audit log, local FS or S3-compatible attachments, full `reqops` CLI.

### Hosted / Enterprise — BSL 1.1 (auto-converts to Apache 2.0 after 3 years)
Lives entirely in `cloud/*` and simply does not exist in the OSS build:
- SSO/SAML + SCIM provisioning
- Audit log export (S3 / Datadog / customer bucket)
- Stripe billing + plan enforcement
- Multi-region Postgres + region pinning
- Hosted MCP gateway (multi-tenant edge, per-tenant rate limits)
- Managed connector OAuth apps (hosted users use ReqOps' client IDs out of the box; self-host users register their own)

---

## 8. Deployment topology

### OSS — `docker-compose.yml`
`postgres` (16) · `redis` (7) · `api` · `web` · `worker` · `mcp` (exposes :7777 streamable HTTP) · `minio` (optional default object store). Single `.env`; `reqops init` writes sensible defaults and runs migrations.

### Hosted
- **Platform**: **Fly.io** — better region story + cheaper egress than Render; avoid AWS-native lock-in.
- **Postgres**: **Fly Postgres** in the same org (staging runs this today — single service, private networking). Alt for prod: Neon (branching = preview envs; scale-to-zero).
- **Redis**: Upstash or Fly Upstash addon.
- **Object storage**: **Cloudflare R2** (S3 API, zero egress).
- **Email**: Resend. **Errors**: Sentry. **Telemetry**: OTel → Axiom.
- **Edge**: Cloudflare in front of `web` and `mcp-gateway` (DDoS + WAF).

Each compose service maps 1:1 to a Fly app; CI deploys per-app.

---

## 9. Queue / worker model (BullMQ)

| Queue | Job types |
|---|---|
| `sync` | `sync.pull_integration`, `sync.process_webhook`, `sync.push_task`, `sync.renew_subscription` |
| `handoff` | `handoff.dispatch`, `handoff.reap_expired`, `handoff.notify_agent` |
| `notifications` | `notify.email`, `notify.in_app` |
| `audit` | `audit.export_batch` (cloud only) |
| `housekeeping` | `cleanup.webhook_deliveries`, `cleanup.audit_rotate` |

Repeatable jobs for polling-only providers (Google Tasks) and subscription renewal (MS Graph, Asana). `jobId` = idempotency key. Failed jobs go to DLQ after 5 attempts with exponential backoff; surfaced in admin UI.

---

## 10. Critical libraries (one-line justifications)

- **Next.js 15 (App Router)** — single React framework with RSC.
- **Hono (apps/api)** — small, fast, Web-standard `Request/Response`; decouples API from Next so it can host webhooks + MCP HTTP independently.
- **Drizzle ORM** — TypeScript-first, SQL-shaped, plays nicely with raw SQL for sync upserts.
- **Better-Auth** (chosen over Auth.js) — framework-agnostic, first-class organization/role primitives that map to `memberships`, real Drizzle adapter. Auth.js is more session-focused and harder to share between API + Next.
- **BullMQ** — battle-tested Redis queue.
- **@modelcontextprotocol/sdk** — official MCP TS SDK; stdio + streamable HTTP transports free.
- **Zod** + **@hono/zod-openapi** — runtime validation + generated OpenAPI for a typed REST client. **Choosing REST over tRPC** because the API also serves webhooks, third-party integrations, and the CLI — tight tRPC coupling fights all of those.
- **@node-rs/argon2** — agent API key hashing.
- **Pino** — structured logging. **OpenTelemetry SDK** — distributed traces.
- **Testcontainers (node)** — real Postgres + Redis in integration tests.
- **shadcn/ui + Tailwind** — `packages/ui` baseline.

---

## 11. MVP execution sequence (six milestones to v0.1, ~8 weeks)

**M1 — Repo skeleton & infra (1 wk)** · pnpm + Turbo init, all package dirs · `packages/db` with Drizzle + first migration (orgs/workspaces/users/memberships/sessions) · `packages/auth` wiring Better-Auth → Drizzle · `apps/api` (Hono) `/health` + Better-Auth handler · `apps/web` sign-in/up + create-workspace · `docker-compose.yml` (postgres + redis + api + web) · `reqops` CLI stub · CI: typecheck + test + build.

**M2 — Tasks core + unified inbox UI (1 wk)** · Migrations for `tasks`, `task_sources`, `task_assignments`, `audit_events` · `packages/core/tasks` service · REST endpoints (`/v1/tasks/*`) with Zod + generated client · Inbox view, task detail drawer, create/edit/comment.

**M3 — Connector framework + Google Tasks + Asana (2 wks)** · `packages/connectors/core`: `ConnectorAdapter` interface (`oauthStart`, `oauthCallback`, `pull`, `push`, `subscribeWebhook`, `handleWebhook`) · OAuth endpoints, AES-256-GCM token storage · Google Tasks polling (60s repeatable job) · Asana webhook receiver + handshake + backfill · `apps/worker` boots · Integrations settings page · Idempotent upsert into `tasks` via `task_sources` unique key.

**M4 — Microsoft connectors (1 wk)** · `microsoft-todo` + `microsoft-planner` sharing a Graph client · Subscription create + auto-renewal job · Both flow into the unified inbox.

**M5 — Handoffs + MCP server (2 wks)** · Migrations for `agents`, `agent_api_keys`, `agent_handoffs`, `handoff_events` · `packages/core/handoffs` state machine + atomic claim · `apps/mcp` stdio + HTTP transports, all tools in §6 · `POST /v1/tasks/:id/handoff`, `POST /v1/handoffs/:id/review` · "Hand off to agent" button, agent picker, review queue, handoff timeline · `reqops create-agent` + `create-agent-key` emit usable key + MCP config snippet · Paperclip adapter skeleton.

**M6 — Polish, docs, self-host release (1 wk)** · Final `docker-compose.yml` with mcp + minio · `reqops doctor` (connectivity + migration drift + queue depth) · README + `/docs` site (Nextra) · Tag v0.1.0, publish images to GHCR · License files: Apache 2.0 on root, BSL stub in `cloud/`.

---

## 12. Critical files to create (representative paths)

- `packages/db/src/schema.ts` — full Drizzle schema (§3)
- `packages/connectors/core/src/adapter.ts` — `ConnectorAdapter` interface
- `packages/connectors/{google-tasks,asana,microsoft-todo,microsoft-planner}/src/index.ts` — one per provider
- `packages/core/src/handoffs/state-machine.ts` — claim/heartbeat/review transitions
- `packages/core/src/tasks/upsert.ts` — sync-key upsert with conflict resolution
- `packages/agent-adapters/paperclip/src/index.ts` — Paperclip bridge
- `apps/mcp/src/server.ts` — MCP tool/resource registration
- `apps/api/src/routes/webhooks.ts` — provider webhook receivers
- `apps/api/src/routes/oauth.ts` — OAuth start/callback
- `apps/worker/src/jobs/*.ts` — BullMQ job handlers
- `apps/cli/src/commands/{init,migrate,doctor,create-agent,create-agent-key}.ts`
- `docker-compose.yml` + `.env.example`

---

## 13. Verification plan (end-to-end smoke for v0.1)

1. **Bootstrap**: `git clone && cp .env.example .env && docker compose up` — all six services healthy in <60s.
2. **Sign up**: register at `http://localhost:3000`, create workspace "Acme".
3. **Connect Google Tasks**: OAuth into sandbox account with 3 pre-seeded tasks; appear in inbox within 90s.
4. **Connect Asana**: OAuth, create a task in Asana, webhook arrives <5s, task appears.
5. **Create + assign**: native ReqOps task, assign to self.
6. **Create an agent + key**: `docker compose exec api pnpm reqops create-agent claude-local && reqops create-agent-key claude-local` — prints key + Claude Desktop config snippet.
7. **Hand off via UI**: click "Hand off" on a task, select `claude-local`. Handoff moves to `queued`.
8. **Claim via MCP**: Claude Code (configured against local MCP) lists claimable tasks, claims, marks in-progress, completes with summary. Verify state walks `queued → claimed → in_progress → completed`, timeline UI renders each event, `audit_events` records every call.
9. **Source-of-truth round-trip**: original task in Google/Asana flips to "Completed" via outbound push within 30s.
10. **Resilience**: `docker compose restart worker` mid-run — in-flight job resumes; no duplicate tasks created on next poll.
11. **Integration test suite** (Testcontainers): upsert dedupe; claim race (two clients race `claim_task`, exactly one wins); webhook idempotency; subscription renewal.
12. **Load smoke**: 10k tasks across 3 integrations; inbox p95 <500ms; sync queue drains <2min.
