# Implementation status & next steps

Updated 2026-06-30. Living status doc for the current build phase. The GitHub Project
"Palouse Roadmap" is the issue tracker; this doc captures in-flight state and the resume
plan. Detailed plan for the current feature lives in the session plan file
`~/.claude/plans/sleepy-gathering-pebble.md`.

## IMPORTANT: uncommitted work

Everything below from this session is **uncommitted on `main`**. Branch + commit (or PR)
before any container reset to avoid losing it. Per repo convention, do not commit to `main`
directly: branch first.

Also pending: **migration `0005_windy_betty_ross.sql`** (invitations table) is generated but
**not yet applied** to staging/prod. It runs on deploy (`pnpm -F @palouse/db migrate`), or
apply manually against a DB before testing invites locally/staging.

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

1. **Finish Slice 3 UI gating** (#47): hide admin-only actions for non-admins (viewer/member).
   - Settings `TaskSourcesPanel`: hide Connect / Sync now / Disconnect when
     `workspace.role` is not owner/admin.
   - Settings `AgentConnectionsPanel`: hide "New agent" for non-admins.
   - `/agents` directory: hide "New agent"; `/agents/[id]`: hide "Create key" + "Revoke".
   - Compute `canManage = role === 'owner' || role === 'admin'` from the workspace role each page
     already loads. Server already enforces, so this is UX polish only.

2. **Slice 4 — account profile** (#48): a Settings "Account" card to edit display name
   (`authClient.updateUser({ name })`) and change password
   (`authClient.changePassword({ currentPassword, newPassword })`). Export those from
   `@/lib/auth-client` if not already. Password reset already exists.

3. **Automated end-to-end testing before deploy** (NEW request, not yet on the board): add an
   E2E harness that runs in CI as a deploy gate. Recommended tracer-bullet approach:
   - Playwright in `apps/web` (or a top-level `e2e/` package).
   - Slice 1: one smoke spec (sign up or seeded sign-in → land on Dashboard) run against the full
     stack brought up via `docker-compose.yml` in CI.
   - Wire into `.github/workflows/ci.yml` and gate `deploy-staging.yml` / `deploy-prod.yml` on it.
   - Then expand to the M-roadmap smoke flows (connect a source, create agent + key, hand off,
     accept invite). Add a "Testing & CI" milestone + epic to the board.

4. **Verify, migrate, commit**: full `pnpm -r typecheck` + `pnpm -F @palouse/web build`; apply
   migration 0005 on staging; branch + commit + PR (see uncommitted note above).

5. **Board bookkeeping**: after an end-to-end test pass, close Phase 4 issues (#20-#25); Team &
   access #43/#44/#45/#46 are code-complete (verify then close), #47 partial (UI gating left),
   #48 open. Add the E2E testing milestone/epic.

## Verify commands

- Typecheck: `pnpm -F @palouse/{shared,core,api,web} typecheck`
- Web build (regenerates typed routes): `pnpm -F @palouse/web build`
- Migration: `pnpm -F @palouse/db generate` (already run for 0005) / `migrate` to apply.
