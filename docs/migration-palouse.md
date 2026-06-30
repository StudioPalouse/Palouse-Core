# Migration Runbook: ReqOps → Palouse

Renames the application from **ReqOps** to **Palouse** (part of the Palouse
Productivity suite) and moves all hosted infrastructure from the `reqops`
(Entorhi) Fly.io organization to the new `palouse` organization.

> ✅ **COMPLETE.** The rename and org move are done; staging runs at
> `test.palouse.ai` and **production is live at `app.palouse.ai`** (see
> [`production-setup.md`](./production-setup.md) and [`deployment.md`](./deployment.md)).
> Phases 1–6 done. Phase 7 (decommission) mostly done — old `reqops-staging-*`
> apps, DB, and Redis destroyed and the org is empty; remaining tidy-up: optionally
> delete the empty `reqops`/Entorhi org and remove stale `test.reqops.ai`
> DNS/cert at Namecheap, and decide `reqops.ai`'s fate. This doc is kept as the
> migration record.

**Locked decisions**
- Staging domain: `test.palouse.ai` (`app.palouse.ai` reserved for prod).
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
> so it looks like "no standalone DB resource." We evaluated MPG for Palouse but
> reverted to legacy Fly Postgres on cost (see locked decisions above).

---

## ⚠️ Prerequisites
- **Domain split:** the app lives on **`palouse.ai`** (`test.palouse.ai` staging,
  `app.palouse.ai` prod); `palouse.io` stays the corporate domain (M365 mailboxes).
- `palouse.ai` DNS is on **Namecheap** (unrestricted), separate from `palouse.io`'s
  M365-managed DNS. App/cert/mail records go on `palouse.ai`; `palouse.io` is untouched.
- Resend: **`mail.palouse.ai`** added and verified as the sending subdomain before
  transactional mail works.

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
4. **Domains** `test.reqops.ai` → `test.palouse.ai`, `MAIL_FROM`
   (`no-reply@mail.palouse.ai`), demo/fixture domains.
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

## Phase 3 — Database — DONE (fresh start)
Started fresh (staging data disposable; avoids the encryption-key problem). The
API `release_command` ran Drizzle migrations on first deploy (Phase 4): 24 tables,
`source_of_truth` enum = `palouse`. Consequence: **re-authorize all connectors**
post-cutover (their encrypted tokens don't carry over).

## Phase 4 — Deploy to Palouse — DONE
api/web/worker deployed (`./scripts/fly-deploy.sh`); all healthy on `*.fly.dev`
(api /health + /health/ready 200, web 200, web→api proxy 401, worker consuming
Redis). mcp excluded until M5. Public DNS not yet moved.

## Phase 5 — DNS cutover + mail (Namecheap `palouse.ai` — manual) — DONE
App DNS is on `palouse.ai` at Namecheap (NOT `palouse.io`/M365).
1. `fly certs add test.palouse.ai --app palouse-staging-web` (done).
2. Namecheap **palouse.ai** Advanced DNS: `CNAME  test → palouse-staging-web.fly.dev`.
3. `fly certs check test.palouse.ai` until Issued; redeploy api/worker (new base URLs).
4. Mail: add Resend domain **`mail.palouse.ai`**, add its records to `palouse.ai`
   (MX `send.mail` → feedback-smtp.<region>.amazonses.com; TXT SPF `send.mail`;
   TXT DKIM `resend._domainkey.mail`; TXT DMARC `_dmarc.mail`). Set `RESEND_API_KEY`
   secret; `MAIL_FROM = "Palouse <no-reply@mail.palouse.ai>"` (already in api.toml).
5. Connector OAuth redirect URIs → `https://test.palouse.ai/oauth/<provider>/callback`.
6. Swap GitHub `FLY_API_TOKEN` to the palouse org token.

## Phase 6 — Verify — DONE
End-to-end on `test.palouse.ai`: sign-in, create task/handoff, re-auth a
connector, mint a `palouse_agk_` key + MCP call, confirm transactional mail
delivers from `no-reply@mail.palouse.ai`.

## Phase 7 — Decommission ReqOps / Entorhi (after a verification window) — MOSTLY DONE
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
