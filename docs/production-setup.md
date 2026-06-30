# Production Setup Runbook — Palouse (public alpha)

Stand up a **production** environment in the `palouse` Fly.io org so public alpha
customers can use the hosted app at **`app.palouse.ai`**. Prod runs parallel to
the existing staging stack and shares nothing with it (own DB, Redis, secrets).

> **This is an execution runbook written for a fresh agent/session.** It is
> self-contained: read the "Current state" section, confirm the open decisions
> in §1, then execute §3 phases P1→P11 in order. Commands mirror the staging
> setup, which is already proven working.

---

## Current state (as of this writing — branch `rename/reqops-to-palouse`)
Done and committed:
- **Rename** ReqOps→Palouse complete (Phase 1), verified (typecheck/test/build green).
- **Staging** fully provisioned + deployed in the `palouse` org on `*.fly.dev`:
  `palouse-staging-{api,web,worker}` deployed & healthy; `mcp` excluded until M5.
  - DB: **legacy Fly Postgres** `palouse-staging-db` (single node, role `palouse_app`,
    db `palouse`). MPG was rejected on cost ($38/mo floor).
  - Redis: `palouse-staging-redis` (Upstash, eviction disabled).
- **Domain split adopted:** app on **`palouse.ai`** (Namecheap DNS, unrestricted);
  `palouse.io` is corporate/M365 mail (untouched). Staging origin = `test.palouse.ai`
  (CNAME → `palouse-staging-web.fly.dev`); cert added, awaiting the CNAME at Namecheap.
- **Mail:** transactional via **Resend** on subdomain `mail.palouse.ai`;
  `MAIL_FROM = "Palouse <no-reply@mail.palouse.ai>"` set in `fly/api.toml`.

Key facts a fresh agent must know:
- Fly org slug: **`palouse`**. `fly auth whoami` = jonathan@palouse.io.
- `palouse.ai` DNS = **Namecheap** (`dns1/dns2.registrar-servers.com`), no usable CLI →
  DNS records are added **manually** by the user in Namecheap Advanced DNS.
- `palouse.io` DNS = **M365-managed** (`ns*.bdm.microsoftonline.com`) — do NOT touch.
- Legacy `fly postgres` is self-managed (you own backups/HA); `jq` is available locally.
- App uses the `postgres` (postgres.js) driver + Drizzle; `DATABASE_URL` is a plain
  Postgres URL. API `release_command` runs migrations on every deploy.
- The OSS build excludes `cloud/` (BUSL) packages; the **hosted prod build includes them**
  (`billing`, `sso-saml`, `audit-export`, `mcp-gateway`). See §1.4.

---

## 1. Decisions to confirm BEFORE executing
These are product/cost calls. Defaults below are the recommendation; confirm with
Jonathan, then proceed.

### 1.1 Postgres durability — **recommend: single-node + automated backups**
Public alpha = real customer data, so no-backup is unacceptable; full HA is 2× cost.
- **Default (recommended):** single node + `--enable-backups` (WAL/point-in-time
  restore to a Tigris bucket). ~$3–5/mo + storage. Upgrade to HA at GA.
- Alt: `--initial-cluster-size 2` for HA failover (≈2× machine cost).

### 1.2 Public email signup — **CONFIRM (product call)**
Staging sets `AUTH_BLOCK_PUBLIC_EMAIL_DOMAINS = "true"` (work emails only). A *public*
alpha may want anyone to sign up.
- If alpha is open to gmail/outlook/etc → set **`"false"`** in `fly/api.prod.toml`.
- If alpha is work-domains-only → keep **`"true"`**.

### 1.3 Transactional mail identity — **recommend: prod on `mail.palouse.ai`, move staging to `mail-staging.palouse.ai`**
To protect prod sender reputation from staging test sends:
- **Prod** sends from `no-reply@mail.palouse.ai` (the Resend domain set up in staging).
- **Recommended refinement:** migrate *staging* to its own Resend domain
  `mail-staging.palouse.ai` (update staging `MAIL_FROM` + add a second Resend domain).
- Simpler alt (acceptable for alpha): both share `mail.palouse.ai`.

### 1.4 Billing / open-core hosted features for alpha — **CONFIRM (product call)**
`cloud/` holds BUSL hosted-only packages (`billing`, `sso-saml`, `audit-export`,
`mcp-gateway`). Decide what's on for alpha:
- **Default:** alpha is **free** → billing OFF, SSO/SAML OFF; ship core only.
- Confirm whether the prod Docker build needs the `cloud/*` packages wired in yet,
  or core-only is fine for alpha. (If billing is off, core-only build is simplest.)

### 1.5 Warm machines vs cost
- **api:** `min_machines_running = 1` (required — proxy targets `.internal`).
- **web:** recommend `min_machines_running = 1` for alpha (avoid cold-start latency
  for real users). Set `0` to save money at the cost of first-hit latency.
- **worker:** 1 always-on.

---

## 2. Cost estimate (alpha, region `iad`, recommended config)
| Item | ~Monthly |
|---|---|
| api (1 warm shared-cpu-1x) | ~$2–4 |
| web (1 warm shared-cpu-1x) | ~$2–4 |
| worker (1 always-on shared-cpu-1x) | ~$2–4 |
| Postgres (single node + backups, shared-cpu-1x, 10 GB) | ~$3–6 |
| Redis (Upstash pay-as-you-go) | usage-based, low at alpha volume |
| **Prod total** | **~$10–18/mo** + Redis usage |

(On top of the existing staging ~$7–8/mo.) Scales up with HA / bigger VMs at GA.

---

## 3. Implementation phases

### P1 — Prod Fly configs (`fly/*.prod.toml`)
Create four files mirroring the staging tomls with prod deltas. Keep staging tomls
untouched.

**`fly/api.prod.toml`** (from `fly/api.toml`, changes only):
```toml
app = "palouse-prod-api"
primary_region = "iad"

[deploy]
  release_command = "pnpm --filter @palouse/db migrate"

[env]
  NODE_ENV = "production"
  LOG_LEVEL = "info"
  API_PORT = "4000"
  API_BASE_URL = "https://app.palouse.ai"
  BETTER_AUTH_URL = "https://app.palouse.ai"
  WEB_BASE_URL = "https://app.palouse.ai"
  AUTH_BLOCK_PUBLIC_EMAIL_DOMAINS = "true"   # see §1.2 — flip to "false" for open alpha
  MAIL_FROM = "Palouse <no-reply@mail.palouse.ai>"

[http_service]
  internal_port = 4000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 1                   # required: web proxy targets .internal

  [[http_service.checks]]
    interval = "15s"; timeout = "5s"; grace_period = "15s"; method = "GET"; path = "/health"

[[vm]]
  size = "shared-cpu-1x"
  memory = "1024mb"                           # prod headroom (staging was 512mb)
```

**`fly/web.prod.toml`** (from `fly/web.toml`):
```toml
app = "palouse-prod-web"
primary_region = "iad"

[build.args]
  NEXT_PUBLIC_API_URL = ""
  API_PROXY_TARGET = "http://palouse-prod-api.internal:4000"

[env]
  NODE_ENV = "production"
  API_PROXY_TARGET = "http://palouse-prod-api.internal:4000"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 1                   # warm for alpha UX (§1.5); set 0 to save cost

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

**`fly/worker.prod.toml`** (from `fly/worker.toml`): same as staging but
`app = "palouse-prod-worker"` and the three base URLs → `https://app.palouse.ai`.

**`fly/mcp.prod.toml`** (from `fly/mcp.toml`): `app = "palouse-prod-mcp"`,
`PALOUSE_API_URL = "https://palouse-prod-api.fly.dev"`, base URLs → `https://app.palouse.ai`.
Deploy only when MCP ships (kept at 0 machines otherwise).

### P2 — Create prod apps (free until machines run)
```bash
for app in palouse-prod-api palouse-prod-web palouse-prod-worker palouse-prod-mcp; do
  fly apps list --org palouse --json | grep -q "\"$app\"" || fly apps create "$app" --org palouse
done
```

### P3 — Prod Postgres (legacy, single node + backups)
```bash
fly postgres create --name palouse-prod-db --org palouse --region iad \
  --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 10 --enable-backups
# Capture the superuser password from output (shown ONCE).
# Create the app role + db (run SQL in-machine; psql backslash cmds don't survive ssh -C):
SU="postgres://postgres:<SU_PW>@localhost:5433/postgres"
DB_PW="$(openssl rand -hex 24)"   # save it
fly ssh console -a palouse-prod-db -C "psql $SU -c \"CREATE ROLE palouse_app LOGIN PASSWORD '$DB_PW';\""
fly ssh console -a palouse-prod-db -C "psql $SU -c \"CREATE DATABASE palouse OWNER palouse_app;\""
# PG15+ gotcha — ensure the app role can create in public (else migrations fail):
fly ssh console -a palouse-prod-db -C "psql postgres://postgres:<SU_PW>@localhost:5433/palouse -c \"ALTER SCHEMA public OWNER TO palouse_app;\""
# Smoke: login + create/drop a table as palouse_app (see staging notes).
```
`DATABASE_URL` = `postgresql://palouse_app:<DB_PW>@palouse-prod-db.flycast:5432/palouse?sslmode=disable`

### P4 — Prod Redis (Upstash, eviction disabled)
```bash
fly redis create --name palouse-prod-redis --org palouse --region iad \
  --no-replicas --disable-eviction --enable-prodpack=false
# Capture the redis:// URL from output.
```

### P5 — Prod secrets (FRESH — never reuse staging values)
```bash
# Set directly (DATABASE_URL/REDIS_URL from P3/P4; RESEND_API_KEY = prod key from Resend):
for app in palouse-prod-api palouse-prod-worker palouse-prod-mcp; do
  fly secrets set --app "$app" \
    DATABASE_URL="postgresql://palouse_app:<DB_PW>@palouse-prod-db.flycast:5432/palouse?sslmode=disable" \
    REDIS_URL="<prod redis url>" \
    BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
    PALOUSE_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
    RESEND_API_KEY="<prod resend key>"
done
```
> Generate `BETTER_AUTH_SECRET`/`PALOUSE_ENCRYPTION_KEY` **once** and use the SAME
> value across api/worker/mcp (they must match), but DIFFERENT from staging.
> `PALOUSE_ENCRYPTION_KEY` must be exactly 64 hex chars.

### P6 — First prod deploy (runs migrations)
```bash
flyctl deploy . --config fly/api.prod.toml    --dockerfile apps/api/Dockerfile    --remote-only --yes
flyctl deploy . --config fly/web.prod.toml    --dockerfile apps/web/Dockerfile    --remote-only --yes
flyctl deploy . --config fly/worker.prod.toml --dockerfile apps/worker/Dockerfile --remote-only --yes
# Verify: api release_command "completed successfully" (migrations), then:
curl -fsS https://palouse-prod-api.fly.dev/health
curl -fsS https://palouse-prod-api.fly.dev/health/ready
```

### P7 — DNS + cert for `app.palouse.ai`
1. `fly certs add app.palouse.ai --app palouse-prod-web`
2. **User adds at Namecheap (`palouse.ai` Advanced DNS):**
   | Type | Host | Value |
   |---|---|---|
   | CNAME | `app` | `palouse-prod-web.fly.dev` |
3. `fly certs check app.palouse.ai` until **Issued** (HTTP-01, no `_acme-challenge` needed).

### P8 — Prod mail (Resend)
- If prod uses `mail.palouse.ai` (already verified from staging): just ensure the prod
  `RESEND_API_KEY` is set (P5) and `MAIL_FROM` is `no-reply@mail.palouse.ai` (P1). Done.
- If splitting per §1.3: add Resend domain `mail-staging.palouse.ai`, repoint staging
  `MAIL_FROM`, and keep prod on `mail.palouse.ai`.

### P9 — Prod deploy workflow (CI, tag-triggered)
Add `.github/workflows/deploy-prod.yml` triggered on version tags (`v*`) or published
releases — separate from staging's push-to-main. Mirror `deploy-staging.yml` but use
the `*.prod.toml` configs and a prod deploy token:
```bash
fly tokens create org -o palouse   # save as a SEPARATE repo secret, e.g. FLY_API_TOKEN_PROD
```
Workflow: deploy api (migrations) → web/worker in parallel → smoke
(`/health`, `/health/ready`, web root). `concurrency.cancel-in-progress: false`.

### P10 — Go-live smoke + checklist
On `https://app.palouse.ai`: sign-up/sign-in, create a task/handoff, trigger a
password-reset email (confirm delivery from `no-reply@mail.palouse.ai`), mint a
`palouse_agk_` key + MCP call (if mcp deployed). Confirm `AUTH_BLOCK_PUBLIC_EMAIL_DOMAINS`
behaves per §1.2.

### P11 — Operations: backups, monitoring, rollback
- **Backups:** confirm `--enable-backups` bucket is receiving WAL; document a restore
  drill. (Self-managed PG — backups are your responsibility.)
- **Monitoring:** wire prod logs/metrics + alerting on `/health/ready` and machine health.
- **Rollback:** `fly releases --app palouse-prod-api` → `fly deploy --image <prev>` or
  `fly machine update`. For a bad migration, roll forward with a fix (don't cancel
  mid-migration; deploys queue by design).

---

## 4. Risks & guardrails
- **Never reuse staging secrets in prod** (esp. `PALOUSE_ENCRYPTION_KEY` /
  `BETTER_AUTH_SECRET`). Distinct values per environment.
- **`PALOUSE_ENCRYPTION_KEY` is unrecoverable** — if lost, all encrypted connector
  tokens become undecryptable. Store the prod value in a password manager / secret vault.
- Self-managed Postgres: **no automatic failover** on single node — accept for alpha,
  plan HA for GA.
- Destructive DB migrations hit prod on deploy — review migrations before tagging a release.
- Keep `palouse.io` / M365 DNS untouched; all app/mail records live on `palouse.ai`.
- Confirm §1.2 (public signup) and §1.4 (billing) before go-live — they change behavior.

---

## 5. Open items to resolve with Jonathan
- [ ] §1.1 DB durability (default: single-node + backups)
- [ ] §1.2 `AUTH_BLOCK_PUBLIC_EMAIL_DOMAINS` for public alpha (true vs false)
- [ ] §1.3 mail split (prod `mail.palouse.ai` + staging `mail-staging.palouse.ai`?)
- [ ] §1.4 billing / cloud BUSL features on for alpha? (default: core-only, free alpha)
- [ ] §1.5 web warm (min 1) vs cost (min 0)
