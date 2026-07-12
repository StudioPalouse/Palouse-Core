# Dependency maintenance and deliberate pins

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
