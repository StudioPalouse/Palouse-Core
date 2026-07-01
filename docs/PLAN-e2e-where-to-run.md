# Where to run E2E (and what runs where)

## Decision

Run the full Playwright E2E suite **once, in CI, before merge**. It is the
pre-merge gate. Do **not** run it again as a deploy-time gate against staging or
prod. After each deploy, run only a lightweight smoke check against the live
environment.

## What runs where

- **CI, on every PR + push (`ci.yml` → `e2e.yml`):** the full Playwright suite
  against an ephemeral, from-source app + throwaway Postgres/Redis. This is the
  real gate. A red run blocks merge (make the `E2E` check required in branch
  protection so this is enforced).
- **Post-deploy to staging (`deploy-staging.yml`):** the `smoke` job only, a
  read-only `curl` against the live env (`/health`, `/health/ready`, web root).
- **Post-deploy to prod (`deploy-prod.yml`):** the same lightweight smoke job
  against live prod. No seeded E2E.

## Why not run the full suite as a deploy gate

- **It re-tests the same commit, not the deployed artifact.** Our E2E stands up
  its own ephemeral stack on the runner; it never talks to the deployed app. So
  running it at deploy time re-validates a commit that already passed CI, in a
  substrate that isn't what actually ships. Near-zero added signal.
- **Staging and prod share configuration.** A second identical run adds deploy
  latency and flakiness risk without telling us anything new.
- **The deployed env has its own, better post-deploy check:** the smoke job hits
  the live URLs, which is the thing we actually want to confirm after a deploy.

## Prod-specific note

Tag pushes do **not** trigger `ci.yml`, so prod has no E2E tied to the tag ref.
This is safe **only** when prod tags are cut from a commit that was already green
on `main`. Enforce that by requiring the `E2E` status check in branch protection
so a red PR cannot merge. Cut prod tags from `main`, not from arbitrary commits.

## How this compares to SpecBoard

Same end-state policy (full E2E once in CI, smoke-only post-deploy), reached for
a different reason. SpecBoard *cannot* run its suite against deployed envs (it
depends on test-only seams that are off there) and *must not* (it seeds/mutates
real data). Palouse's suite is safe to run anywhere because it uses a throwaway
ephemeral stack, so keeping it out of deploys here is an optimization choice, not
a hard constraint. Either way the setups converge on the same shape.

## Known gaps

- The E2E suite covers the web + API + auth + Postgres happy path (sign up →
  sign in → create workspace → dashboard). It does **not** exercise the external
  connectors (Google Tasks, Asana, Microsoft, Notion); those OAuth/webhook paths
  are covered by manual dogfooding today, with dedicated integration tests to
  follow.
- Expand the suite with more roadmap flows over time (connect a source, create an
  agent + key, hand off a task, accept an invite).
