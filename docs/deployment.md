# Deployment — Fly.io (staging + production)

The staging environment is where everything gets tested from M4 onward — cloud
first, local second. One Fly app per compose service (architecture §8), with
Postgres and Redis also on Fly so the whole environment lives in one org:

| Piece | Where | Name / URL |
|---|---|---|
| API (Hono) | Fly `iad` | `palouse-staging-api` → <https://palouse-staging-api.fly.dev> |
| Web (Next.js) | Fly `iad` | `palouse-staging-web` → <https://palouse-staging-web.fly.dev> |
| Worker (BullMQ) | Fly `iad` | `palouse-staging-worker` (no public URL) |
| MCP | Fly `iad` | `palouse-staging-mcp` → `mcp-test.palouse.ai` (streamable HTTP at `/mcp`, per-request agent-key auth) |
| Postgres | Fly `iad` | `palouse-staging-db` (single node, private — `palouse-staging-db.flycast:5432`) |
| Redis | Upstash via Fly | `palouse-staging-redis` (eviction disabled — BullMQ requirement) |

Config lives in `fly/*.toml` (one per app). Non-secret env (URLs, ports,
`NODE_ENV`) is in each toml's `[env]`; secrets are pushed with
`scripts/fly-secrets.sh`. The API app's `release_command` runs Drizzle
migrations on every deploy, before new machines receive traffic.

## One-time setup

```bash
fly auth login
./scripts/fly-provision.sh        # creates the 4 apps + Fly Postgres + Upstash Redis
                                  # (prints REDIS_URL; follow its prompt to create the
                                  #  palouse_app role + palouse database on Postgres)

cp .env.staging.example .env.staging
# Fill in: DATABASE_URL (palouse_app password chosen during provisioning),
# REDIS_URL (printed by provision), and generate
# BETTER_AUTH_SECRET / PALOUSE_ENCRYPTION_KEY per the comments in the file.

./scripts/fly-secrets.sh          # pushes secrets to api / worker / mcp
./scripts/fly-deploy.sh           # first deploy of all four apps
```

For CI deploys, create a deploy token and save it as the `FLY_API_TOKEN`
repository secret on GitHub:

```bash
fly tokens create org -o palouse
gh secret set FLY_API_TOKEN
```

## Continuous deploys

`.github/workflows/deploy-staging.yml` runs on every push to `main`:

1. **deploy-api** — builds on Fly's remote builders, runs migrations via the
   release command, then rolls API machines.
2. **deploy-services** — web, worker, and mcp in parallel.
3. **smoke** — `GET /health`, `GET /health/ready` (DB reachable), the web
   root, and the MCP `/healthz` must all return success or the run fails.

Deploys queue rather than cancel (`concurrency.cancel-in-progress: false`) so a
migration is never interrupted mid-flight.

## Day-to-day cloud testing

```bash
./scripts/fly-deploy.sh api            # deploy one app from your working tree
fly logs --app palouse-staging-api      # tail logs
fly logs --app palouse-staging-worker
fly ssh console --app palouse-staging-api   # shell inside a machine
fly secrets list --app palouse-staging-api
curl https://palouse-staging-api.fly.dev/health/ready
```

Testing a branch without merging: `./scripts/fly-deploy.sh` deploys whatever is
checked out locally — staging does not have to track `main`.

Connector testing in the cloud: webhooks finally work end-to-end (no tunnel
needed). Point each provider's OAuth app redirect URI at
`https://palouse-staging-web.fly.dev/oauth/<provider>/callback` and set the
client ID/secret pairs in `.env.staging`, then re-run `./scripts/fly-secrets.sh`.
Asana will subscribe real webhooks because `API_BASE_URL` is publicly reachable.

## Single public origin (rewrite proxy)

Browsers only ever talk to the **web origin**. `apps/web/next.config.mjs`
rewrites `/v1/*`, `/api/*`, `/oauth/*`, and `/webhooks/*` server-side to the API
over Fly private networking (`API_PROXY_TARGET = http://palouse-staging-api.internal:4000`),
so auth cookies are first-party and no infra hostname is user-visible. Because
`.internal` DNS only lists started machines, the API keeps
`min_machines_running = 1`.

Consequences:
- `API_BASE_URL`, `BETTER_AUTH_URL`, and `WEB_BASE_URL` all point at the web
  origin — OAuth callbacks and provider webhooks enter through the proxy too.
- `NEXT_PUBLIC_API_URL` is empty (same-origin). Setting it re-points the browser
  at an API origin directly; only do that with a shared parent domain.
- Direct API access at `https://palouse-staging-api.fly.dev` still works for
  health checks and machine-to-machine clients (CLI, MCP agents).

## Request guards (CSRF, content-type, body size)

Cookie-authenticated `/v1` mutations (POST/PUT/PATCH/DELETE) require an `Origin`
header equal to `WEB_BASE_URL` and, when they carry a body, `Content-Type:
application/json`. Browsers send Origin automatically and the rewrite proxy
forwards it, so the normal web app is unaffected. If you script these routes
directly with a session cookie (rather than an agent API key), set the `Origin`
header yourself. Agent-key routes (`/v1/otlp`, MCP) and provider webhooks use
bearer or signature auth and are exempt.

Request bodies are capped before they are read: 1 MB by default, 64 KB for
`/api/auth/*`, 256 KB for `/webhooks`, 2 MB for `/v1/objectives/import`, and
5 MB for `/v1/otlp`. Over-limit requests get `413`. Raise the OTLP or import
ceilings in `apps/api/src/middleware/body-limits.ts` if you ingest larger
batches.

### Rate limits

Fixed-window per-minute limits (backed by Redis, fail-open on a Redis outage)
protect the most-abused endpoints. Over-limit requests get `429` with a
`Retry-After` header. Buckets are keyed per client IP (`Fly-Client-IP`, then the
leftmost `X-Forwarded-For` hop), except OTLP (per agent key, since many agents
share one egress IP) and CSV import (per user). Defaults, override via env, set
any to `0` to disable that bucket:

| Env var | Endpoint | Default (per min) |
| --- | --- | --- |
| `RATE_LIMIT_AUTH_PER_MIN` | `/api/auth/*` (sign-in, reset, sign-up) | 10 |
| `RATE_LIMIT_OAUTH_PER_MIN` | `/oauth/*` (connector start + callback) | 20 |
| `RATE_LIMIT_WEBHOOK_PER_MIN` | `/webhooks/*` | 240 |
| `RATE_LIMIT_OTLP_PER_MIN` | `/v1/otlp` (per agent key) | 300 |
| `RATE_LIMIT_IMPORT_PER_MIN` | `/v1/objectives/import` (per user) | 10 |

The MCP HTTP endpoint (`apps/mcp`) is a separate process and is not yet
rate-limited; edge limits (Fly) are the current backstop there.

## Custom domains

Domain split: the **app lives on `palouse.ai`** (`test.palouse.ai` staging,
`app.palouse.ai` prod); `palouse.io` is the corporate domain (M365 mail) and is
not used for app hosting. `palouse.ai` DNS is on **Namecheap** (host field is
relative to `palouse.ai`).

Staging setup (certs added via
`fly certs add test.palouse.ai --app palouse-staging-web` and
`fly certs add mcp-test.palouse.ai --app palouse-staging-mcp`); records at
Namecheap:

| Type  | Host       | Value                          |
|-------|------------|--------------------------------|
| CNAME | `test`     | `palouse-staging-web.fly.dev`  |
| CNAME | `mcp-test` | `palouse-staging-mcp.fly.dev`  |

A CNAME (not A/AAAA) keeps it off the shared Fly IP and survives IP changes; Fly
validates the cert over HTTP-01 through it. (Alternative: `A test → 66.241.124.106`,
IPv4 only.)

After the cert verifies (`fly certs check test.palouse.ai`):
1. Public origin in `fly/api.toml`, `fly/worker.toml`, `fly/mcp.toml`
   (`API_BASE_URL` / `BETTER_AUTH_URL` / `WEB_BASE_URL`) → `https://test.palouse.ai`.
2. Redeploy: `./scripts/fly-deploy.sh api worker mcp web`.
3. Connector OAuth app redirect URIs →
   `https://test.palouse.ai/oauth/<provider>/callback`.

The API needs no certificate of its own: public traffic enters through the web
origin's rewrite proxy, and `palouse-staging-api.fly.dev` remains for direct
machine-to-machine use. Production repeats the same steps with `app.palouse.ai`
against `palouse-prod-web` and `mcp.palouse.ai` against `palouse-prod-mcp`
(CNAME `mcp → palouse-prod-mcp.fly.dev`).

The MCP server gets its own hostname (rather than a path under the web origin)
because it is a separate Fly app: agents talk straight to it with a Bearer
agent key, no proxy hop. The protocol endpoint is `/mcp`
(`https://mcp-test.palouse.ai/mcp` staging, `https://mcp.palouse.ai/mcp` prod);
these URLs are baked into the web build as `NEXT_PUBLIC_MCP_URL` (see
`fly/web*.toml` build args) so onboarding snippets render the right endpoint.

## Costs & scaling notes

**Standing rule: hosting spend stays at a bare minimum while testing.**
Running footprint is one warm API machine (the rewrite proxy targets
`.internal`, which can't wake stopped machines), one worker machine, and
nothing else: web machines auto-stop to zero between requests, the mcp app
auto-stops to zero between agent calls, and the spare api/worker machines are stopped
standbys (no compute billed). Roughly $7–8/mo in machines plus pay-as-you-go
Redis commands.

- Web auto-stops (`min_machines_running = 0`) and auto-starts on request.
- Postgres is a single Fly machine (`shared-cpu-1x`, 1 GB volume, ~$2–3/mo) in
  the same org — private networking only (`.flycast`, no TLS, no public IP).
  No HA on staging by design; production gets its own properly sized cluster.
  Connect ad-hoc with `fly postgres connect -a palouse-staging-db`.
- Upstash Redis must keep eviction disabled or BullMQ can silently lose jobs.

History: staging originally ran on a free-tier Supabase Postgres (project
`reqops-staging`, from the app's former name); it was consolidated onto Fly in June 2026 so the whole
environment lives in one provider, and the Supabase project was paused.

## Production (live — public alpha)

Production runs in parallel to staging in the same `palouse` org, sharing
nothing with it (own DB, Redis, secrets). It is **live at
<https://app.palouse.ai>** (current release `v0.1.2`). Full build/runbook:
[`docs/production-setup.md`](./production-setup.md).

| Piece | Name / URL |
|---|---|
| API | `palouse-prod-api` → <https://palouse-prod-api.fly.dev> (1 warm machine) |
| Web | `palouse-prod-web` → `app.palouse.ai` (auto-stops to zero; cold start at alpha) |
| Worker | `palouse-prod-worker` (always-on) |
| MCP | `palouse-prod-mcp` → `mcp.palouse.ai` (streamable HTTP at `/mcp`; auto-stops to zero) |
| Postgres | `palouse-prod-db` (single node, **WAL backups to Tigris**, 7-day PITR window) |
| Redis | `palouse-prod-redis` (Upstash, eviction disabled) |

Config is `fly/*.prod.toml` (mirrors the staging tomls; api has 1 GB RAM, base
URLs point at `https://app.palouse.ai`). The cert was added with
`fly certs add app.palouse.ai --app palouse-prod-web` + a Namecheap CNAME
`app → palouse-prod-web.fly.dev`.

**Prod deploys are gated on version tags**, separate from staging's deploy-on-push:
`.github/workflows/deploy-prod.yml` runs on tags matching `v*` (and manual
`workflow_dispatch`), using the `*.prod.toml` configs and the
`FLY_API_TOKEN_PROD` repo secret. Same job shape as staging (api+migrations →
web/worker/mcp → smoke). To ship:

```bash
git tag -a v0.1.3 -m "…" && git push origin v0.1.3   # triggers deploy-prod.yml
```

Operations (backup restore drill, rollback, monitoring) are documented in
`docs/production-setup.md` §P11. Active uptime alerting is deferred to GA; Fly
auto-restarts unhealthy api machines and metrics are at <https://fly-metrics.net>.

> **Hosted auth policy:** email verification is required before sign-in (gated on
> `RESEND_API_KEY` being set, so bare self-host installs aren't affected). Mail is
> sent via Resend from `no-reply@mail.palouse.ai`.
