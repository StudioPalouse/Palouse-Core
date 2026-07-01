# Implementation status & next steps

Updated 2026-06-30. Living status doc for the current build phase. The GitHub Project
"Palouse Roadmap" is the issue tracker; this doc captures in-flight state and the resume
plan. Detailed plan for the current feature lives in the session plan file
`~/.claude/plans/sleepy-gathering-pebble.md`.

## Status of committed work

The earlier feature batch (UI refresh, Agents UI, Team & access members/invitations, Slice 3
backend enforcement) is committed on `main` (`cecccdc`…`973e189`). The Slice 3 UI gating,
Slice 4 account profile, and E2E harness below are going out on a branch + PR (per repo
convention, do not commit to `main` directly).

Pending: **migration `0005_windy_betty_ross.sql`** (invitations table) is committed but not yet
applied to staging/prod. It runs on the next deploy (`pnpm -F @palouse/db migrate`).

## Shipped & verified this session (typecheck + build clean)

- **UI refresh** (#20 groundwork): left sidebar nav (Dashboard, Objectives, Projects, Tasks,
  Decisions, Context, Agents, Settings), mobile drawer, blue-tinted dark mode via `next-themes`,
  Dashboard home. `next-themes` + `dropdown-menu` primitive added.
- **Phase 4 Agents UI** (#21-#24): `/agents` directory (tasks + $ this month), `/agents/[id]`
  detail (usage strip, 30-day sparkline, API keys with one-time reveal + MCP snippet, recent
  handoffs), `/agents/spend` (charts via `recharts`, CSV, date range). Backend `agentId` filter
  added to `usageSummaryQuery` + `getWorkspaceSpend`.
- **Settings restructure**: single "Connections" card with an internal tab (Task sources vs
  Agent connections).
- **Team & access Slice 1 — members** (#43, #44): `listMembers` / `updateMemberRole` /
  `removeMember` + `requireRole` in `packages/core/src/workspaces/service.ts`; routes
  `GET/PATCH/DELETE /v1/workspaces/:id/members`; Settings "Team" card (list, role select, remove)
  gated on the current user's role.
- **Team & access Slice 2 — invitations** (#45, #46): `invitations` table + enum (migration 0005);
  `createInvite` / `listInvites` / `revokeInvite` / `acceptInvite` (token hashed with SHA-256,
  7-day expiry); routes under `/v1/workspaces/:id/invitations` + `POST /v1/invitations/accept`;
  invite email via `@palouse/mail` (added as an `apps/api` dep); `/invite` accept page;
  sign-in `?next=` support. Web typecheck clean.
- **Team & access Slice 3 (backend half) — role enforcement** (#47): `requireRole('owner'|'admin')`
  applied to agent create/key/revoke (`routes/agents.ts`), integration sync/delete
  (`routes/integrations.ts`), and OAuth start (`routes/oauth.ts`). Members/invites already gated
  in the service.

## Not done yet / resume here

1. **Slice 3 UI gating** (#47) — DONE. Admin-only actions hidden for non-admins (viewer/member)
   via `canManage = role === 'owner' || role === 'admin'`:
   - Settings `TaskSourcesPanel`: Connect / Sync now / Disconnect hidden.
   - Settings `AgentConnectionsPanel`: "New agent" hidden.
   - `/agents` directory: "New agent" hidden; `/agents/[agentId]`: "Create key" + "Revoke" hidden.
   - Server already enforced; this was UX polish only. Web typecheck clean.

2. **Slice 4 — account profile** (#48) — DONE. Settings "Account" card (`AccountCard` in
   `apps/web/src/app/settings/page.tsx`): edit display name (`updateUser({ name })`), read-only
   email, and change password (`changePassword({ currentPassword, newPassword,
   revokeOtherSessions: true })`). `updateUser` / `changePassword` now exported from
   `@/lib/auth-client`. Web typecheck clean.

3. **Automated end-to-end testing before deploy** — DONE (Slice 1 tracer bullet). Playwright in a
   top-level `e2e/` package (`@palouse/e2e`); one smoke spec (`tests/smoke.spec.ts`: sign up →
   sign in → create workspace → land on Dashboard). Reusable workflow `.github/workflows/e2e.yml`
   brings the stack up from source against throwaway Postgres + Redis services (RESEND_API_KEY
   unset so email verification is not enforced), then runs the browser flow. Wired into `ci.yml`
   (runs on every PR/push) as the pre-merge gate. It is NOT a deploy-time gate: deploys run only
   the post-deploy `curl` smoke against the live env (see `docs/PLAN-e2e-where-to-run.md`). The
   Playwright run script is `e2e` (not `test`) so turbo's `pnpm test` does not trigger it in the
   plain build job.
   - NOTE: not yet executed against a live stack (no Docker in the dev sandbox). First real run is
     in CI on the PR. Watch that run.
   - EXPAND LATER: M-roadmap smoke flows (connect a source, create agent + key, hand off, accept
     invite). Add a "Testing & CI" milestone + epic to the board.

4. **Migration + PR**: full `pnpm typecheck` green (25 tasks). Apply migration 0005 on staging
   (runs on next deploy). Branch + commit + PR for the Slice 3 gating + Slice 4 + E2E work.

5. **Board bookkeeping**: after an end-to-end test pass, close Phase 4 issues (#20-#25); Team &
   access #43/#44/#45/#46 code-complete (verify then close); #47 and #48 now code-complete.
   Add the E2E testing (#49?) milestone/epic.

## Verify commands

- Typecheck: `pnpm typecheck` (turbo, all packages) or `pnpm -F @palouse/{shared,core,api,web} typecheck`
- Web build (regenerates typed routes): `pnpm -F @palouse/web build`
- Migration: `pnpm -F @palouse/db generate` (already run for 0005) / `migrate` to apply.
- E2E locally: bring up the stack, then `pnpm -F @palouse/e2e install:browser && pnpm -F @palouse/e2e e2e` (see `e2e/README.md`).
