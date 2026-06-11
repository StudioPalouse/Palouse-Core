# Deployment — Fly.io staging

The staging environment is where everything gets tested from M4 onward — cloud
first, local second. One Fly app per compose service (architecture §8), with
Postgres and Redis also on Fly so the whole environment lives in one org:

| Piece | Where | Name / URL |
|---|---|---|
| API (Hono) | Fly `iad` | `reqops-staging-api` → <https://reqops-staging-api.fly.dev> |
| Web (Next.js) | Fly `iad` | `reqops-staging-web` → <https://reqops-staging-web.fly.dev> |
| Worker (BullMQ) | Fly `iad` | `reqops-staging-worker` (no public URL) |
| MCP | Fly `iad` | `reqops-staging-mcp` (placeholder until M5; HTTP service commented out in `fly/mcp.toml`) |
| Postgres | Fly `iad` | `reqops-staging-db` (single node, private — `reqops-staging-db.flycast:5432`) |
| Redis | Upstash via Fly | `reqops-staging-redis` (eviction disabled — BullMQ requirement) |

Config lives in `fly/*.toml` (one per app). Non-secret env (URLs, ports,
`NODE_ENV`) is in each toml's `[env]`; secrets are pushed with
`scripts/fly-secrets.sh`. The API app's `release_command` runs Drizzle
migrations on every deploy, before new machines receive traffic.

## One-time setup

```bash
fly auth login
./scripts/fly-provision.sh        # creates the 4 apps + Fly Postgres + Upstash Redis
                                  # (prints REDIS_URL; follow its prompt to create the
                                  #  reqops_app role + reqops database on Postgres)

cp .env.staging.example .env.staging
# Fill in: DATABASE_URL (reqops_app password chosen during provisioning),
# REDIS_URL (printed by provision), and generate
# BETTER_AUTH_SECRET / REQOPS_ENCRYPTION_KEY per the comments in the file.

./scripts/fly-secrets.sh          # pushes secrets to api / worker / mcp
./scripts/fly-deploy.sh           # first deploy of all four apps
```

For CI deploys, create a deploy token and save it as the `FLY_API_TOKEN`
repository secret on GitHub:

```bash
fly tokens create org -o reqops
gh secret set FLY_API_TOKEN
```

## Continuous deploys

`.github/workflows/deploy-staging.yml` runs on every push to `main`:

1. **deploy-api** — builds on Fly's remote builders, runs migrations via the
   release command, then rolls API machines.
2. **deploy-services** — web, worker, and mcp in parallel.
3. **smoke** — `GET /health`, `GET /health/ready` (DB reachable), and the web
   root must all return success or the run fails.

Deploys queue rather than cancel (`concurrency.cancel-in-progress: false`) so a
migration is never interrupted mid-flight.

## Day-to-day cloud testing

```bash
./scripts/fly-deploy.sh api            # deploy one app from your working tree
fly logs --app reqops-staging-api      # tail logs
fly logs --app reqops-staging-worker
fly ssh console --app reqops-staging-api   # shell inside a machine
fly secrets list --app reqops-staging-api
curl https://reqops-staging-api.fly.dev/health/ready
```

Testing a branch without merging: `./scripts/fly-deploy.sh` deploys whatever is
checked out locally — staging does not have to track `main`.

Connector testing in the cloud: webhooks finally work end-to-end (no tunnel
needed). Point each provider's OAuth app redirect URI at
`https://reqops-staging-web.fly.dev/oauth/<provider>/callback` and set the
client ID/secret pairs in `.env.staging`, then re-run `./scripts/fly-secrets.sh`.
Asana will subscribe real webhooks because `API_BASE_URL` is publicly reachable.

## Single public origin (rewrite proxy)

Browsers only ever talk to the **web origin**. `apps/web/next.config.mjs`
rewrites `/v1/*`, `/api/*`, `/oauth/*`, and `/webhooks/*` server-side to the API
over Fly private networking (`API_PROXY_TARGET = http://reqops-staging-api.internal:4000`),
so auth cookies are first-party and no infra hostname is user-visible. Because
`.internal` DNS only lists started machines, the API keeps
`min_machines_running = 1`.

Consequences:
- `API_BASE_URL`, `BETTER_AUTH_URL`, and `WEB_BASE_URL` all point at the web
  origin — OAuth callbacks and provider webhooks enter through the proxy too.
- `NEXT_PUBLIC_API_URL` is empty (same-origin). Setting it re-points the browser
  at an API origin directly; only do that with a shared parent domain.
- Direct API access at `https://reqops-staging-api.fly.dev` still works for
  health checks and machine-to-machine clients (CLI, MCP agents).

## Custom domains

Domain plan: **staging lives on `test.reqops.ai`**; **`www.reqops.ai` is
reserved for production** and gets wired up when the prod environment exists.
DNS is hosted at Namecheap.

Staging setup (cert already added via
`fly certs add test.reqops.ai --app reqops-staging-web`); DNS records at
Namecheap (host field is just `test` / `_acme-challenge.test`):

| Type  | Host                   | Value                                  |
|-------|------------------------|----------------------------------------|
| A     | `test`                 | `66.241.125.213`                       |
| AAAA  | `test`                 | `2a09:8280:1::126:2677:0`              |
| CNAME | `_acme-challenge.test` | `test.reqops.ai.ondnrge.flydns.net`    |

(Alternative to A+AAAA: `CNAME test -> ondnrge.reqops-staging-web.fly.dev`.)

After the cert verifies (`fly certs check test.reqops.ai`):
1. Public origin in `fly/api.toml`, `fly/worker.toml`, `fly/mcp.toml`
   (`API_BASE_URL` / `BETTER_AUTH_URL` / `WEB_BASE_URL`) → `https://test.reqops.ai`.
2. Redeploy: `./scripts/fly-deploy.sh api worker mcp web`.
3. Connector OAuth app redirect URIs →
   `https://test.reqops.ai/oauth/<provider>/callback`.

The API needs no certificate of its own: public traffic enters through the web
origin's rewrite proxy, and `reqops-staging-api.fly.dev` remains for direct
machine-to-machine use. Production later repeats the same steps with
`www.reqops.ai` against the `reqops-prod-web` app.

## Costs & scaling notes

**Standing rule: hosting spend stays at a bare minimum while testing.**
Running footprint is one warm API machine (the rewrite proxy targets
`.internal`, which can't wake stopped machines), one worker machine, and
nothing else: web machines auto-stop to zero between requests, the mcp app is
scaled to 0 machines until M5, and the spare api/worker machines are stopped
standbys (no compute billed). Roughly $7–8/mo in machines plus pay-as-you-go
Redis commands.

- Web auto-stops (`min_machines_running = 0`) and auto-starts on request.
- Postgres is a single Fly machine (`shared-cpu-1x`, 1 GB volume, ~$2–3/mo) in
  the same org — private networking only (`.flycast`, no TLS, no public IP).
  No HA on staging by design; production gets its own properly sized cluster.
  Connect ad-hoc with `fly postgres connect -a reqops-staging-db`.
- Upstash Redis must keep eviction disabled or BullMQ can silently lose jobs.

History: staging originally ran on a free-tier Supabase Postgres (project
`reqops-staging`); it was consolidated onto Fly in June 2026 so the whole
environment lives in one provider, and the Supabase project was paused.

## Production (later)

Production gets its own `fly/*.prod.toml` set, its own Postgres (a properly
sized Fly Postgres cluster, or Neon per architecture §8), its own Redis, and a tag- or
release-triggered workflow. Nothing in the staging setup assumes it is the only
environment — app names, URLs, and secrets are all per-environment.
