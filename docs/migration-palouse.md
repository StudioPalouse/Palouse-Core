# Migration Runbook: ReqOps → Palouse

Renames the application from **ReqOps** to **Palouse** (part of the Palouse
Productivity suite) and moves all hosted infrastructure from the `reqops`
(Entorhi) Fly.io organization to the new `palouse` organization.

**Locked decisions**
- Staging domain: `test.palouse.io` (`www.palouse.io` reserved for prod).
- Full rename, including wire-level identifiers (DB role/name, agent-key prefix,
  encryption-key env var, OTLP attribute keys, `ReqOpsError`).
- Postgres: stays on **legacy self-managed Fly Postgres** (single node,
  ~$2–3/mo). MPG was evaluated and provisioned, but its cheapest tier
  ("development" = Basic) is **$38/mo** — ~12× the legacy cost and against the
  minimal-staging-spend rule — so we reverted. (Prod can revisit MPG later.)
- Fly org slug: `palouse`.

**Guiding principle:** Phases 1–4 build the new Palouse stack *alongside* the
running ReqOps one. Nothing in the old `reqops`/Entorhi org is touched until the
cutover (Phase 5) is verified. Decommission (Phase 7) is last.

> ### Why a "standalone Postgres" exists for ReqOps but not SpecBoard
> Both have a database. ReqOps uses **legacy Fly Postgres** (`reqops-staging-db`,
> image `flyio/postgres-flex`, created with `fly postgres create`) — an
> *unmanaged Postgres app* that runs as a regular Fly app and appears in
> `fly apps list`; you own its role creation, HA, backups, and upgrades.
> SpecBoard uses **Fly Managed Postgres (MPG)** (`specboard-db`, plan `basic`),
> a managed cluster that appears only in `fly mpg list` — not in the app list —
> so it looks like "no standalone DB resource." This migration switches ReqOps
> onto MPG to match.

---

## ⚠️ Prerequisites
- `palouse.io` DNS is managed at Namecheap and under our control.
- Resend: `palouse.io` added and verified as a sending domain before mail works
  on the new origin.

---

## Phase 1 — Codebase rename (reversible; one branch + PR)
~142 files. Done in categories, each grep-verified. Scope rename first so
imports resolve.

1. **npm scope** `@reqops/*` → `@palouse/*` (24 packages): every `package.json`
   `name` + dependency refs, `pnpm-workspace.yaml`, `tsconfig.base.json`,
   `turbo.json`, `cloud/README.md` OSS filter. Then `pnpm install` to regenerate
   `pnpm-lock.yaml`.
2. **Brand strings** "ReqOps" → "Palouse": UI (`layout.tsx`, sign-in/up,
   app-shell, dialogs), `README.md`, `docs/*`, `cloud/README.md`.
3. **Fly app names** `reqops-staging-{api,web,worker,mcp,db,redis}` →
   `palouse-staging-*`: `fly/*.toml`, `scripts/fly-*.sh`,
   `.github/workflows/deploy-staging.yml`, `docs/deployment.md`, `.env*.example`.
   Includes `*.fly.dev`, `.internal`/`.flycast` hosts, `REQOPS_API_URL`.
4. **Domains** `test.reqops.ai` → `test.palouse.io`, `MAIL_FROM`
   (`no-reply@test.palouse.io`), demo/fixture domains.
5. **Wire-level identifiers:**
   - DB role `reqops_app` → `palouse_app`, DB name `reqops` → `palouse`
     (`packages/db` schema/migrations/`drizzle.config.ts`, env examples).
   - OTLP attribute keys `reqops.*` → `palouse.*` (`packages/core/src/usage/`).
   - `ReqOpsError` → `PalouseError` (`packages/shared/src/errors.ts` + sites).
   - `REQOPS_ENCRYPTION_KEY` → `PALOUSE_ENCRYPTION_KEY` (`packages/config`,
     `apps/api`, `apps/worker`, `apps/cli/init.ts`, env examples).
   - Agent-key prefix `reqops_agk_` → `palouse_agk_` (mint **and** validate:
     `packages/core/src/agents/service.ts`, `apps/mcp/src/auth.ts`,
     `apps/api/middleware/agent-key.ts`). Pre-issued staging keys stop
     validating → re-mint after cutover.
6. **Verify:** `grep -ri reqops` returns only intentional past-tense history
   notes. Then `pnpm install && pnpm -r typecheck && pnpm -r build && pnpm -r test`.

## Phase 2 — Provision the Palouse org (new, parallel) — DONE
`scripts/fly-provision.sh` with `FLY_ORG=palouse`:
- Create apps `palouse-staging-{api,web,worker,mcp}`. ✓
- **Legacy Fly Postgres:** `fly postgres create --name palouse-staging-db
  --org palouse --region iad --initial-cluster-size 1 --vm-size shared-cpu-1x
  --volume-size 1`; then create `palouse_app` role + `palouse` db (palouse_app
  owns `public`), and set `DATABASE_URL` (private `.flycast`, `sslmode=disable`)
  on api/worker/mcp via `fly-secrets.sh`. ✓
  (MPG was provisioned then destroyed — see cost note above.)
- Upstash Redis `palouse-staging-redis` (**eviction disabled**). ✓
- Fresh `BETTER_AUTH_SECRET` + `PALOUSE_ENCRYPTION_KEY` pushed via `fly-secrets.sh`. ✓
- Deploy token deferred to Phase 5 (don't swap GitHub `FLY_API_TOKEN` until cutover).

## Phase 3 — Database
**Default: start fresh** (staging data disposable; avoids the encryption-key
problem). API `release_command` runs Drizzle migrations and builds the schema in
MPG on first deploy. Consequence: **re-authorize all connectors** post-cutover
(their encrypted tokens don't carry over).
*Alternative if data is needed:* `pg_dump` → restore into MPG **and keep the old
encryption key value** so tokens still decrypt.

## Phase 4 — Deploy to Palouse
`./scripts/fly-deploy.sh api` (runs migrations), then `web worker mcp`.
Smoke-test `*.fly.dev/health` + `/health/ready`. Public DNS not yet moved.

## Phase 5 — DNS cutover (Namecheap — manual)
1. `fly certs add test.palouse.io --app palouse-staging-web`; read values from
   `fly certs show`.
2. Namecheap on **palouse.io**: `A test → <IP>`, `AAAA test → <v6>`,
   `CNAME _acme-challenge.test → <flydns target>`.
3. `fly certs check test.palouse.io` until Issued; redeploy if needed.
4. Connector OAuth redirect URIs → `https://test.palouse.io/oauth/<provider>/callback`.
5. Swap GitHub `FLY_API_TOKEN` to the palouse org token.

## Phase 6 — Verify
End-to-end on `test.palouse.io`: sign-in, create task/handoff, re-auth a
connector, mint a `palouse_agk_` key + MCP call, confirm mail from palouse.io.

## Phase 7 — Decommission ReqOps / Entorhi (after a verification window)
Destroy `reqops-staging-*` apps + `reqops-staging-db` + `reqops-staging-redis`;
remove `test.reqops.ai` cert + Namecheap records; revoke old org deploy token.
Open question: keep `reqops.ai` as a redirect or drop it.

---

## Risks
- Fly **cannot move apps between orgs** — recreate-and-cutover, not a transfer.
- Encryption-key change ⇒ fresh DB requires connector re-auth (Phase 3).
- Agent-key prefix change invalidates pre-issued staging keys (re-mint).
- `pnpm-lock.yaml` must be regenerated, not hand-edited.
- Don't swap CI's `FLY_API_TOKEN` until cutover.
