# Dependency maintenance and deliberate pins

> **Backlog tracked in Specboard.** Actionable dependency work is under the **Dependency
> maintenance** epic (release **Security & Hardening**): the drizzle-orm upgrade, the
> @better-auth/oauth-provider advisory review, and a Dependabot ignore rule for the pins below.
> This document remains the canonical record of why each pin exists. Reconciled 2026-07-14.

This document records dependencies we hold back on purpose, why, and what it
would take to unpin them. Dependabot opens upgrade PRs automatically; when one is
declined for a reason that is not obvious from the diff, capture that reasoning
here so the next person (or the next Dependabot PR) does not relitigate it.

## Pinned dependencies

| Package | Pinned at | Latest declined | Mechanism | Reason |
|---|---|---|---|---|
| `bullmq` | 5.78.0 | 5.80.1 (PR #126) | `pnpm.overrides` in root `package.json` | Newer minors tighten the job-name generics and the Redis connection type; adopting them needs a TypeScript queue-typing pass. See below. |
| `ioredis` | 5.10.1 | 5.11.1 (PR #126) | `pnpm.overrides` in root `package.json` | Same as bullmq: BullMQ consumes the ioredis connection type, so the two move together. See below. |

Both pins were introduced in commit `fced287` (2026-07-01, "chore(deps): update
in-range dependencies to latest"), which deferred them alongside the other major
upgrades (Next 16, Zod 4, TypeScript 6, Drizzle 0.45, recharts 3, vitest 4, pino
10, commander 15, @hono/node-server 2).

Because they are pinned through `pnpm.overrides`, a plain Dependabot bump cannot
succeed: Dependabot updates the version in `pnpm-lock.yaml` but cannot edit the
`pnpm.overrides` block in `package.json`, so the two disagree and CI fails on
`pnpm install --frozen-lockfile` (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`). This is
what happened to PR #126.

## bullmq / ioredis: what the "queue-typing migration" would give us

Assessed 2026-07-12 against PR #126 (bump `bullmq` 5.78.0 -> 5.80.1 and `ioredis`
5.10.1 -> 5.11.1).

### How we use these libraries

`packages/queue/src/index.ts` is the only real consumer:

- **BullMQ**: two queues (`sync`, `handoff`), the plain `Queue<SyncJobData>` /
  `Queue<HandoffJobData>` data generic, and basic `add` / `upsertJobScheduler` /
  `Worker`. No flows, no job priorities, no `ignoreDependencyOnFailure`.
- **ioredis**: `new IORedis(url, opts)` with a few options
  (`maxRetriesPerRequest`, `enableOfflineQueue`, `connectTimeout`,
  `commandTimeout`) and a handful of commands (`set`, `exists`, `incr`,
  `pexpire`). No cluster, no large pipelines, none of the newer commands.

### What the declined releases actually contain

- **BullMQ 5.79 -> 5.80.1**: all bug fixes (priority boundary enforcement,
  job-scheduler offset coercion, a queue-events delay type fix, flow-retry with
  `ignoreDependencyOnFailure`). Every one touches a feature we do not use. No CVE.
- **ioredis 5.11.0 / 5.11.1**: cluster-reconnection and protocol-relative-URL
  fixes, a pipeline `RangeError` fix, `url.parse()` -> WHATWG URL, and several new
  commands (`increx`, `MSETEX`, vector sets, `TracingChannel`, etc.). Nothing we
  call. No CVE.

### What unpinning would buy us

1. **Dependency hygiene (the real reason).** It retires a permanent pin, stops
   the recurring Dependabot noise, and keeps the gap from widening until the
   eventual catch-up is painful.
2. **Optional stronger type safety.** Newer BullMQ lets you constrain the
   job-name generic (`Queue<Data, Result, Name>`), so a typo'd job name or a
   payload that does not match its name would fail at compile time. A nice-to-have
   we would opt into; we do not have it today and have not been bitten by its
   absence.
3. **Minor future-proofing**, e.g. ioredis dropping the deprecated Node
   `url.parse()`.

There is no feature we need, no bug fix we would hit, and no security fix in these
specific releases.

### Scope of the migration

It is a TypeScript-only change, not a database or data migration:

- Widen the `Queue<...>` generics to the newer signature.
- Fix the ioredis connection-type structural mismatch that BullMQ's
  `ConnectionOptions` now expects.
- Re-run typecheck on the two workers (`apps/worker`, `apps/api/src/queue.ts`).

Zero runtime or behavior change, no schema change, all caught by `tsc`. Estimated
an hour or two.

### Recommendation

Keep the pin. Do the unpin deliberately when one of these becomes true:

- a security advisory lands on `bullmq` or `ioredis`,
- we specifically want the job-name compile-time type safety, or
- the drift has grown enough to justify one deliberate catch-up bump.

When that day comes, do the version bump and the generics/connection type fixes in
the same change (update `pnpm.overrides`, regenerate the lockfile, fix the types),
rather than accepting a lockfile-only Dependabot PR that will fail
`--frozen-lockfile`.

To silence repeat Dependabot PRs in the meantime, add a narrow `ignore` for just
`bullmq` and `ioredis` in `.github/dependabot.yml`.

> **Done 2026-07-14.** The `bullmq` / `ioredis` `ignore` rule is now in
> `.github/dependabot.yml` (npm ecosystem), with a comment pointing back here.

## @better-auth/oauth-provider advisory (GHSA-p2fr-6hmx-4528): staying on 1.6.23

Assessed 2026-07-14. `pnpm audit --prod` reports a moderate advisory
(CVSS 6.4) against `@better-auth/oauth-provider`: **unbound resource
indicators**. The provider does not bind the JWT `aud` claim to the grant, so a
client can request an access token for any audience in `validAudiences`, and a
refresh token can be redeemed for a different resource than originally granted.

- **Affected:** `>= 1.4.8 < 1.7.0-beta.4`. We run `1.6.23` (declared `^1.6.23`
  in `packages/auth`, `apps/web`, `apps/api`), so we are in range.
- **Patched:** only `1.7.0-beta.4+`. The 1.6.x line is not patched, and 1.7.0
  has no stable release (`latest` is `1.6.23`; the 1.7 line only reaches
  `rc.1`).

### Decision: stay on 1.6.23 and rely on our existing mitigations

The fix ships as part of the 1.7.0 rewrite, which is **not a drop-in patch**:

- `@better-auth/oauth-provider` and `better-auth` core move in lockstep, so
  taking the fix upgrades the whole auth stack (sessions, JWT plugin, social
  providers, drizzle adapter, the accounts-token encryption we just shipped).
- 1.7.0 **removes `validAudiences` entirely**, replacing it with a `resources` /
  `oauthClientResource` model. It requires a schema migration (new tables
  `oauthResource`, `oauthClientResource`; new columns on `oauthClient`,
  `oauthAccessToken.revoked`, `jwks.alg`/`crv`) plus other breaking changes
  (back-channel logout, PKCE default on, custom claims can no longer override
  protected fields, id_token verification rework).
- It is still prerelease, so we would be pinning a moving `rc` on a
  security-critical path and re-verifying on every bump.

Our practical exposure is low because we already apply **both** workarounds the
advisory documents:

1. **Single audience.** `packages/auth/src/mcp-oauth.ts` sets
   `validAudiences: [mcpAudience(env)]` — exactly one entry. With one valid
   audience there is no second resource to re-target a token at.
2. **Resource server pins `aud`.** `apps/mcp/src/auth.ts` verifies every MCP
   access token with `audience: oauthAudience()` and rejects any mismatch.

A regression test (`packages/auth/src/mcp-oauth.test.ts`) fails if anyone widens
`validAudiences` beyond a single entry, so the mitigation can't silently erode.

**Revisit when `better-auth` 1.7.0 reaches a stable (non-prerelease) release.**
At that point do the coupled upgrade deliberately: bump provider + core together,
run the auth schema migration, port `validAudiences` to the new `resources`
model, and re-run the full MCP OAuth E2E (dynamic client registration, sign-in,
workspace selection, consent, token mint, refresh, revocation).

### Transitive moderates surfaced by the same audit

`pnpm audit --prod` on 2026-07-14 also reported two transitive moderates, both
outside the original backlog.

- **postcss** GHSA-qx2v-qp2m-jg93 (XSS via unescaped `</style>` in CSS stringify
  output; `< 8.5.10`). Transitive via `next → postcss`. **Resolved 2026-07-20:**
  added `"postcss": ">=8.5.10"` to `pnpm.overrides`, which lifts the transitive
  `postcss@8.4.31` to `8.5.16`. `pnpm audit --prod` no longer reports it. Low
  risk (patch/minor within the 8.x line; Next's PostCSS usage is stable across
  8.4 to 8.5).
- **esbuild** GHSA-67mh-4wv8-2f99 (dev-server can be reached cross-site;
  `<= 0.24.2`). Reaches us only through
  `@better-auth/oauth-provider → better-auth → drizzle-kit → @esbuild-kit/... →
  esbuild@0.18.20`, a build-time path with no prod-runtime impact.
  **Accepted 2026-07-20 (build-time-only transitive, no runtime exposure).** A
  direct override to `>= 0.25.0` is not safe: `drizzle-kit`'s pinned
  `@esbuild-kit/*` loader expects the old esbuild API. Clears naturally with the
  eventual better-auth 1.7 upgrade or a `drizzle-kit` bump that drops the old
  loader. Re-check on each `pnpm audit --prod` run.
