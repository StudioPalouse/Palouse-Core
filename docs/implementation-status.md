# Implementation status & next steps

Updated 2026-07-03. Living status doc for the current build phase. The GitHub Project
"Palouse Roadmap" is the issue tracker; this doc captures in-flight state and the resume plan.

## Where things stand

Production is live at **app.palouse.ai**. Prod is deployed by cutting a `vX.Y.Z` tag
(`deploy-prod.yml`); staging auto-deploys on push to `main` (`deploy-staging.yml`). Both run a
post-deploy `curl` smoke; the full Playwright E2E suite is the **pre-merge** gate in CI, not a
deploy gate (see `docs/PLAN-e2e-where-to-run.md`). `main` has branch protection requiring the
`E2E` and `build` checks to merge.

Prod release history: `v0.1.0-alpha.1` → `v0.1.2` (auth: confirm-password + email verification)
→ `v0.2.0` (team & access + account profile + E2E harness) → `v0.3.0` (workspace switcher +
user/account management) → `v0.4.x` (nav/IA restructure + Context sections, dep bumps)
→ `v0.5.x` (Microsoft admin-consent hand-holding, brand identity, green dark mode)
→ `v0.6.0` (handoff/review UX queue + multi-select bulk hand-off) → **`v0.7.0`** (hosted MCP
endpoint + agent onboarding).

## Shipped & live in prod

- **UI refresh**: sidebar nav, mobile drawer, blue-tinted dark mode (`next-themes`), Dashboard home.
- **Phase 4 Agents UI** (#21-#24): `/agents` directory, `/agents/[agentId]` detail (usage strip,
  30-day sparkline, API keys with one-time reveal + MCP snippet), `/agents/spend` (recharts, CSV).
- **Team & access epic** (#49), tracer-bullet sliced:
  - Members (#43/#44): `listMembers` / `updateMemberRole` / `removeMember`; Settings Team card.
  - Invitations (#45/#46): `invitations` table (migration 0005), create/list/revoke/accept, invite
    email, `/invite` accept page, sign-in `?next=`.
  - Role enforcement (#47): `requireRole('owner'|'admin')` on agent/integration/oauth routes +
    Settings UI gating (`canManage`).
  - Account profile (#48): Settings Account card (display name via `updateUser`, change password via
    `changePassword`).
- **E2E harness**: `@palouse/e2e` Playwright package; one smoke spec (sign up → sign in → create
  workspace → dashboard). Reusable `.github/workflows/e2e.yml` stands the stack up from source
  against throwaway Postgres/Redis. CI pre-merge gate only; branch protection enforces it.
- **Workspace switcher** (#52): `WorkspaceProvider` + `useActiveWorkspace()`
  (`apps/web/src/lib/workspace-context.tsx`); active workspace persisted in localStorage; sidebar
  switcher; all 8 authenticated pages read the active workspace from context (no more `workspaces[0]`).
- **User management** (#53, v0.3.0):
  - Deactivate/reactivate members: `memberships.status` (migration 0006). Deactivated members keep
    their row (work stays attributable) but lose access; `requireMembership` /
    `listWorkspacesForUser` are active-only. Settings Team card shows status + Deactivate/Reactivate.
  - Guards count **active** owners, so you cannot remove, demote, or deactivate the last active
    owner (this is the "can't lock yourself out" rule).
  - "Remove" deletes the membership only (removes from this account; login survives elsewhere).
- **Account deletion** (#54, v0.3.0): owner-only, two-step. Level 1 = type the exact account name
  (Settings danger zone). Level 2 = click a one-time emailed link (hashed token, 1h expiry) →
  `/account/delete`. Confirm deletes the backing org (cascade); `usage_rollups_daily` (no FK) cleared
  explicitly. `account_deletion_tokens` = migration 0007. Routes: `POST /v1/workspaces/:id/deletion`,
  `POST /v1/account/deletion/confirm`.
- **Nav/IA restructure** (v0.4.0): sidebar sections with Context (architecture/systems/process),
  Objectives, Projects, Decisions placeholder pages; settings split into layout + subpages
  (organization, integrations, team); workspace-deletion terminology migration (0008, see
  `docs/glossary.md`). v0.4.1 added the expandable Context nav; v0.4.2 was dep bumps.
- **Microsoft admin-consent + brand** (#57, v0.5.0): hand-holding flow for tenants that require
  admin consent on the ms_tasks connector; brand identity (logo mark, auth lockup, favicon, OG
  image). v0.5.1 moved dark mode from blue to brand green.
- **Handoff/review UX queue** (#59-#61, v0.6.0): handoff visibility on task rows, quick hand-off,
  bulk approve, send-back choice, reviews polish, and multi-select task rows with bulk hand-off.
  Cross-component refresh via the `handoffs-changed` window event.
- **Hosted MCP endpoint + agent onboarding** (#62, v0.7.0): `apps/mcp` deployed to
  `palouse-staging-mcp` / `palouse-prod-mcp`, custom domains `mcp-test.palouse.ai` /
  `mcp.palouse.ai`, protocol pinned to `/mcp`, per-request Bearer agent-key auth (tenancy rides
  the key, one flat endpoint for all workspaces). Create-key dialog leads with a `claude mcp add`
  one-liner + HTTP JSON config (endpoint baked via `NEXT_PUBLIC_MCP_URL` build arg); stdio snippet
  is the self-hosted fallback. `palouse create-agent-key` mirrors this when `PUBLIC_MCP_URL` is
  set. mcp is back in both deploy matrices with a `/healthz` smoke step. Verified live with an
  authenticated initialize / tools/list / list_tasks round-trip.

## Next / backlog

1. **Board bookkeeping**: close the shipped issues — Phase 4 (#20-#25), Team & access epic
   (#43-#49). Open a Testing & CI epic; open issues for the user-management work if not tracked.
2. **Manual dogfood on staging**: exercise the destructive account-deletion path end to end
   (type-name → email link → delete a throwaway workspace) and confirm the cascade. The E2E smoke
   does not cover it.
3. **Agent dogfood on prod**: connect a real Claude Code instance to a prod workspace via the
   new onboarding flow and run a task through the full handoff loop (claim → progress → review).
4. **Expand E2E**: more roadmap flows (connect a source, create agent + key, hand off, accept
   invite) and ideally a deletion-path spec.
5. **User/account management follow-ups** (not yet built): transfer ownership as a first-class
   action; leave-workspace (self-removal); global user hard-delete (deliberately deferred — admin
   delete is remove-from-account only); pending-invite UX polish (resend, expiry countdown).
6. **Multi-workspace orgs**: v1 is 1:1 org↔workspace (`createWorkspace` makes a backing org). The
   switcher already supports a user in multiple workspaces via invites; true multi-workspace orgs
   are a later change.
7. **Ops tidy-up**: delete the empty `reqops`/Entorhi Fly org and stale `test.reqops.ai` DNS.
   (The actions runner bump, #40, shipped in #56.)

## Verify commands

- Typecheck: `pnpm typecheck` (turbo, all packages).
- Web build (regenerates typed routes): `pnpm -F @palouse/web build`.
- Migrations: `pnpm -F @palouse/db generate` to author, `migrate` to apply (runs on deploy).
- E2E locally: bring up the stack, then `pnpm -F @palouse/e2e install:browser && pnpm -F @palouse/e2e e2e`
  (see `e2e/README.md`).
