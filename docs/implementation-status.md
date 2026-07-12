# Implementation status & next steps

Updated 2026-07-12. Living status doc for the current build phase. The GitHub Project
"Palouse Roadmap" is the issue tracker; this doc captures in-flight state and the resume plan.

## Resume here: Decisions expansion, now on Theme A / A2 (2026-07-12)

Pick-up point for the decisions-capability expansion (`docs/decisions-roadmap.md`).

**Just finished: Theme E (strategy linkage) is complete on `main`.** Slice 1
decision to objective and key-result linking (`d68359a`), Slice 2 decision to project
roll-up (`a7b0e47`), Slice 3 dashboard strategy signals (`e5d8aa7`). This closes roadmap
goal 5 and gives Palouse a direct, queryable decision-to-OKR/key-result edge.

**Uncommitted in the working tree right now (commit these first):**

- **MCP `get_strategy_signals` tool** — `apps/mcp/src/server.ts`, `packages/mcp-sdk/src/index.ts`.
  Exposes `decisionService.getStrategySignals` to agents (scope `decisions:read`, capability
  `decisions`, per-signal gating on objectives/projects in the handler). Full typecheck green.
- **`docs/plans/copilot-declarative-agent-a2.md`** (new) — the A2 Copilot declarative-agent
  scoping doc.
- This status update.

**Next actions, in order:**

1. Commit the working-tree changes above (branch off `main`; the MCP tool is a self-contained
   change and can be its own commit/PR).
2. Answer the **A2 open questions** in `docs/plans/copilot-declarative-agent-a2.md` §6 before
   building: DCR-vs-static spike order, which tools the first pilot exposes, where the Teams app
   package lives in the repo, which pilot tenant to sideload into, and the agent's branding.
3. Start **A2 slice 1 (spike + verify)** in a test tenant, no production code: confirm the OAuth
   **token endpoint returns no 307**, PKCE works, a minted token's **audience = `PUBLIC_MCP_URL`**
   and **issuer = `${BETTER_AUTH_URL}/api/auth`** (so `apps/mcp/src/auth.ts` accepts it unchanged),
   and `offline_access` yields a refresh token. Try the **`DynamicClientRegistration`** auth type
   first (our provider already has DCR enabled) before committing to a static client. This is the
   pause-for-feedback point. Build/verify steps and risks are in the scoping doc §4-§7.

**Context / not blocking:** #126 (bullmq/ioredis bump) is closed; the deliberate-pin rationale
lives in `docs/dependencies.md`. Theme D reporting is the natural place to later surface strategy
signals more broadly. After A2, the roadmap continues with the Teams transcript connector (A3)
and the extraction pipeline (A1/A4).

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
→ `v0.6.0` (handoff/review UX queue + multi-select bulk hand-off) → `v0.7.0` (hosted MCP
endpoint + agent onboarding) → `v0.8.0` (agent-originated tasks via `create_task` + live-ish
task board polling) → `v0.9.0` (per-workspace capability toggles with nav gating) → `v0.10.0`
(`start_task` + task status sync + provenance badge + per-environment snippet alias)
→ `v0.11.0` (Todoist connector) → `v0.12.0` (task list UX redesign) → `v0.13.0` (Decisions
capability) → `v0.14.0` (agent connect + archive) → `v0.15.0` (Objectives / OKRs) → `v0.16.0`
(Projects: Kanban + Gantt) → `v0.17.0` (MCP OAuth connect) → **`v0.18.0`** (Fieldwork design
language: IBM Plex type, green-tinted token system, tokenized data-viz + semantic status pills,
circular brand mark + horizon motif, grow-toward-green progress, reduced-motion-aware motion;
plus the tasks first-run empty state).

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
- **Agent-originated tasks: `create_task` MCP tool** (#63, v0.8.0): agents can register
  work handed to them directly in chat. One call creates the task (starts `in_progress`) and
  atomically opens a handoff already claimed by the calling agent (`openClaimedHandoff` +
  `createAgentTask` in the handoff state machine, transactional), returning the `claimToken` so the
  existing log_step/heartbeat/complete rail works unchanged. Tasks gain provenance:
  `origin` (`task_origin` enum) + `created_by_agent_id` (migration 0010), surfaced in the Task DTO.
  `reviewRequired` is agent-settable per task, default false. Redundant agent guidance: server
  `instructions` on the McpServer, the create_task tool description, and a nudge in the
  `claim_task` empty response. Scope: `tasks:write` plus `handoffs:claim` (checked in-handler).
  Deferred at the time: UI provenance badge, `start_task`, task.status sync (all shipped in
  v0.10.0 below).
- **Task board keeps itself fresh** (v0.8.0): the Tasks page list refetches on the same 15s
  cadence as the handoff badges (and on `handoffs-changed`), so agent-created tasks and status
  changes appear without a manual reload. Real-time push (SSE over Redis pub/sub) deliberately
  deferred until the live agent-activity/audit view needs it.
- **Agent workflow follow-ups** (v0.10.0): `start_task` MCP tool (self-claim on an existing task a
  person points the agent at; scope `handoffs:claim`; `openClaimedHandoff` now validates the task
  and workspace). Task status follows the handoff lifecycle (user-confirmed full sync): claim →
  in_progress, completion or approved review → done, fail/cancel/requeue → open; human-set
  blocked/archived never overridden (`syncTaskStatus` in the state machine, guarded from-states).
  Agent provenance badge on task rows and the detail sheet (`task.origin === 'agent'`, Bot icon).
  Onboarding snippets use a per-environment client alias (`palouse-test` on staging, `palouse` on
  prod/self-hosted) in the key dialog and `palouse create-agent-key`, so both environments can be
  connected side by side. Still deferred: SSE real-time push, agent-name resolution in the UI.

- **Per-workspace capability toggles** (v0.9.0): owners/admins turn product areas (Tasks,
  Decisions, Projects, Context, Objectives) on or off per workspace from Settings > Workspace.
  Disabled areas drop out of the sidebar for everyone and direct links render an elegant
  turned-off state (`CapabilityDisabled`) with dashboard/settings actions. Dashboard and Settings
  are deliberately not gateable (dashboard is the post-login landing; settings hosts the toggles).
  Storage: `workspace_capabilities` table (migration 0011); rows are overrides, absence = enabled,
  so existing workspaces need no backfill. `capabilityService` in `@palouse/core`
  (`capabilitiesForWorkspace` is auth-free for key-carried callers); GET/PATCH
  `/v1/workspaces/:id/capabilities` (writes gated to owner/admin via `requireRole`); the map rides
  on `WorkspaceProvider` (module-cached, no nav flash); `CapabilityGate` in the app shell swaps
  disabled routes; new no-dep ARIA `Switch` in `@palouse/ui`. Deferred: gate MCP tools (e.g. task
  tools when Tasks is off) via `capabilitiesForWorkspace` inside `apps/mcp/src/server.ts`.

## Next / backlog

0. **MCP OAuth connect — SHIPPED to prod as v0.17.0 (2026-07-07)**: paste the MCP URL into
   a client and sign in with Palouse credentials instead of minting a key by hand. Better
   Auth `@better-auth/oauth-provider` + `jwt`; workspace selection at consent (postLogin
   hook), consent pinned to an agent id, access-token JWT carries workspace/agent claims;
   migration 0017 (oauth/jwks tables + `mcp_connect_selections`). Slice 1 = flow + migration
   (PR #81); slice 2 = connect dialog leads with sign-in, OAuth connections surfaced in
   Settings > Agents, archive is a full OAuth revoke (PR #82). Agent keys stay as the
   manual/self-hosted path. Design: `docs/PLAN-mcp-oauth.md`. **Slice 3 (deferred, not yet
   built):**
   - Last-used / activity timestamp for OAuth connections (they have no `agent_api_keys`
     row, so no `lastUsedAt`; derive from `audit_events` or stamp the agent on use).
   - Granular scope selection on the consent screen (today consent grants the full
     advertised scope set).
   - Trusted first-party clients (skip consent) once we ship our own MCP clients.
   - Policy: allow the `member` role to self-connect (today owner/admin only, matching key
     minting).
   - MCP tool gating by workspace capability inside `apps/mcp/src/server.ts` (still deferred
     from v0.9.0; the OAuth path inherits the same gap).
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
