# Theme E: Strategy linkage (decisions to projects and objectives)

Status: implementation plan (2026-07-11). Parent: `docs/decisions-roadmap.md` (goal 5,
Theme E). This is the roadmap's recommended **first** slice.

**Resolved 2026-07-11 (open question: first-class key-result linking?):** yes. Key
results get their own first-class link, not just objective-level linking. This adds
`key_result` to the `decision_entity_type` enum (a one-way `ALTER TYPE ... ADD VALUE`
migration; see the data model section) and a KR picker plus read-side hydration of KR
title/progress/status. Because KRs have no status column of their own, "at risk" for a KR
is derived from its parent objective's status when surfacing strategy signals (E3).

**One-line goal:** wire decisions to objectives (and key results) and projects, resolve
those links in both directions, and surface the resulting strategy signals, so a decision
sits visibly alongside the goals and projects it affects.

## 1. Why this goes first

Roadmap goals served: **goal 5** (deepen the relationship of decisions to projects and
objectives) directly, and it seeds **goal 4** (reporting) by making decision-to-strategy
edges queryable.

Recommended first because:

- **Fastest visible win, mostly internal wiring.** The polymorphic `decision_relations`
  table, the `goal` entity type, the RACI model, the capability-aware dashboard, and the
  objectives/projects capabilities all already exist. Most of Theme E is connecting parts
  that are already in the tree, not building new subsystems.
- **Closes a real competitive gap cheaply.** Market research (roadmap section 1) found no
  verified product offering a direct, queryable decision-to-OKR/key-result edge. Atlassian
  Home scopes decisions to a project and reaches goals only indirectly. Palouse's schema
  already reserves the `goal` entity type; it is simply not wired up. Shipping E1/E2 puts
  Palouse ahead of the field with days of work, not weeks.
- **Low migration risk.** The enum already carries `goal`; the only likely DDL is a reverse
  index (and, if we choose first-class key results, one `ALTER TYPE ... ADD VALUE`).
- **It unblocks later themes.** Theme C (supersession propagation) needs reverse relation
  resolution to notify stakeholders of related projects/objectives; Theme D (strategy
  metrics, decision register) needs the same reverse edges to report. Building this cleanly
  now means C and D consume it rather than reinventing it.

## 2. Prerequisites and dependencies

Largely none. That is the point of sequencing it first.

- **Depends on:** objectives capability (migration 0015, shipped v0.15.0) and projects
  capability (migration 0016, shipped v0.16.0). Both are live in prod. No new external
  services, no queue work, no connector work.
- **Already partly built (reuse, do not duplicate):**
  - `projectService.linkDecision` / `unlinkDecision` already write `decision_relations`
    rows with `entityType: 'project_item'` (card-level links), and `getProject` already
    hydrates `linkedDecisions` (relationId, decisionId, title, status) per card. So
    decision-to-card linking exists end to end today; the project *page* just does not show
    a project-level "Decisions" roll-up yet.
  - `LinkedDecision` DTO already exists in `packages/shared/src/project.ts`.
  - `ENTITY_TYPE_LABELS` in `apps/web/src/lib/decision-meta.ts` already includes
    `goal: 'Goal'`, `project: 'Project'`, `project_item: 'Card'`.
  - `add_decision_relation` MCP tool already delegates to `decisionService.addRelation`
    with an arbitrary `entityType`, so a `goal` link inserts successfully over MCP today
    (it is just unresolved on read).
- **Consumed by later themes:** Theme C supersession propagation and Theme D strategy
  metrics both build on the reverse-lookup functions introduced here. Design the reverse
  lookups as reusable service functions, not one-off route handlers.

## 3. Refined sub-feature scope

- **E1. Wire decisions to objectives and key results.**
  - Resolve `goal` relations on read: `getDecision` must hydrate each `goal` relation to
    its objective title and status (today it returns bare `entityType`/`entityId`).
  - Resolve `project` relations on read too, since `project` is also reserved-but-unmapped
    (only `project_item` is wired). Linking a decision to a whole project (not a card) is a
    natural user request and costs nothing extra to hydrate.
  - Add objective and project pickers to the relations section of
    `decision-detail-sheet.tsx`, which today only offers a task picker.
  - **Key-result decision:** in slice 1, link decisions to the **objective**, not to
    individual key results. Key results have no `status` column (they carry
    start/current/target only), so a KR-level edge adds a new enum value and a new resolver
    for marginal early value. Revisit as a fast-follow if users ask (open question O1).
- **E2. Reverse lookups.** A "Decisions" section on the objective detail sheet and on the
  project detail page: which decisions support this goal / affect this project. Requires
  querying `decision_relations` by `(entity_type, entity_id)` in the reverse direction,
  which nothing does today (there is a `decision_idx` on `decision_id` only).
- **E3. Strategy signals.** Dashboard surfacing on the existing capability-aware dashboard:
  open decisions on at-risk objectives, and projects carrying unresolved `proposed`
  decisions. Kept deliberately small; it is a later slice within the theme.

## 4. Data model changes (by content)

Minimal by design.

- **Enum:** `decision_entity_type` already includes `goal`, `project`, `project_item`,
  `task`, `context` (`packages/db/src/schema/decisions.ts`, mirrored in
  `packages/shared/src/decision.ts`). No enum change is needed to link decisions to
  objectives (`goal`) or whole projects (`project`).
- **Reverse index (recommended):** add a composite index on
  `decision_relations (entity_type, entity_id)` so reverse lookups
  ("all decisions linked to this objective/project") are index-served rather than a full
  scan. Today only `decision_relations_decision_idx` on `(decision_id)` exists, which does
  not help the reverse direction. Add it to the schema builder and a migration:

  ```ts
  entityLookupIdx: index('decision_relations_entity_idx').on(t.entityType, t.entityId),
  ```

- **Key-result entity type (confirmed first-class, per the 2026-07-11 decision):** add a
  `key_result` value with `ALTER TYPE decision_entity_type ADD VALUE 'key_result';` and
  mirror it in `packages/shared/src/decision.ts` and the `decision-meta.ts` label map
  ("Key result"). Postgres gotchas to respect: `ADD VALUE` cannot run inside the same
  transaction that then uses the new value (so keep the `ALTER TYPE` in its own migration
  step ahead of any code that inserts it), and the value cannot be dropped later. KR
  relations resolve against `key_results` (title + current/target progress); since KRs
  have no status column, derive "at risk" from the parent objective's status for E3
  signals. The `context` value stays reserved and out of scope here.
- **Migration numbering:** the current max migration is `0018_webhook-hardening.sql`. The
  next number is assigned by the drizzle generator at implementation time. **Do not
  hardcode a migration number in code or docs;** run the generator and take whatever it
  produces (expected `0019`, but confirm).
- **No new tables.** All linkage rides the existing polymorphic `decision_relations` table.
  The unique index `decision_relations_decision_entity_uq` on
  `(decision_id, entity_type, entity_id)` already dedupes links, and `addRelation` already
  uses `onConflictDoNothing` against it for idempotency.

## 5. Core service layer

All services live at `packages/core/src/<area>/service.ts` and are exported from
`@palouse/core`. They take `(db, workspaceId, actor, ...)` and write `audit_events`.

- **`getDecision` hydration (`decisions/service.ts`).** Today it returns
  `relations: relations.map(relationToDto)` with only `entityType`/`entityId`. Enrich it so
  `goal` and `project` relations carry a resolved title and status. Approach: after loading
  the raw relation rows, bucket their `entityId`s by `entityType`; run one grouped query per
  resolvable type against the target table scoped to `workspaceId`:
  - `goal` -> `objectives` (title, status),
  - `project` -> `projects` (name, status),
  - `task` -> `tasks` (title, status) (fold the existing client-side task-title lookup into
    the server for consistency),
  - `project_item`/`context` -> leave `label: null` for now (out of scope; render the id).

  Return an enriched relation shape, e.g. `{ ...relation, label: string | null,
  targetStatus: string | null }`, following the grouped-query, no-fan-out pattern already
  used by `listDecisions` counts and `loadKeyResultProjects`. Titles are resolved
  server-side so the web sheet and MCP both get labels without extra round-trips. Guard for
  the case where a linked entity was deleted (id points at nothing): return `label: null`
  rather than throwing, since `entityId` is not a hard FK.

- **`objectiveService.listRelatedDecisions(db, workspaceId, objectiveId)`
  (`objectives/service.ts`).** Reverse lookup: inner-join `decision_relations` (filtered
  `entityType = 'goal'`, `entityId = objectiveId`) to `decisions` (scoped to `workspaceId`),
  returning `{ relationId, decisionId, title, status }` — reuse the `LinkedDecision` shape.
  Uses the new `decision_relations_entity_idx`. Loaded on demand, not folded into the
  `getObjective` rollup query, to keep the hot progress path lean (mirrors how
  `getProject` computes links separately).

- **`projectService.listRelatedDecisions(db, workspaceId, projectId)`
  (`projects/service.ts`).** Reverse lookup for **project-level** links
  (`entityType = 'project'`, `entityId = projectId`). This is distinct from the card-level
  `linkedDecisions` already returned per `project_item`. Same `LinkedDecision` return shape.
  Optionally also surface the union of card-level decisions as a project roll-up, but keep
  project-level and card-level clearly separated in the response so the UI can label them.

- **Where reverse resolution is shared:** the join is trivial and each service owns its
  side, so no shared helper is needed initially. If a third consumer appears (it will, in
  Themes C/D), extract a `decisionService.listDecisionsForEntity(db, workspaceId,
  entityType, entityId)` helper and have the objective/project services call it. Note this
  as a refactor seam, do not build it speculatively (tracer-bullet principle).

## 6. API routes

Hono routes under `apps/api/src/routes/`, all behind `requireSession` plus the per-area
`require<Area>Access` capability check.

- **`GET /decisions/:id`** (`decisions.ts`): no signature change. The richer hydrated
  relations flow through automatically once `getDecision` returns them, as long as the
  shared `decisionRelationSchema`/`decisionDetailSchema` DTOs are extended to carry the new
  optional `label`/`targetStatus` fields (section 5).
- **Reverse lookups — fold into existing detail endpoints, do not add new top-level
  routes.** Add the related decisions to the objective and project detail responses so the
  client gets them in one fetch:
  - `GET /objectives/:id` -> include `relatedDecisions: LinkedDecision[]` in
    `ObjectiveDetail`.
  - `GET /projects/:id` -> include `relatedDecisions: LinkedDecision[]` (project-level) in
    `ProjectDetail`, alongside the existing per-card `linkedDecisions`.

  Folding avoids an extra client round-trip and an extra capability gate, and matches how
  `getProject` already returns card-level decision links inline. Both endpoints already run
  their capability checks (`requireObjectivesAccess`, `requireProjectsAccess`), so the
  reverse-decision data inherits the right gating for free. (Cross-capability note: a
  decision title shown on an objective page is decision data appearing under the objectives
  gate; that is acceptable, but respect the reverse too — see section 10.)
- **Linking a decision to an objective/project** reuses the existing
  `POST /decisions/:id/relations` with `entityType: 'goal'` or `'project'`. No new endpoint;
  `addRelationInput` already validates any enum value.

## 7. MCP tools

Tools in `packages/mcp-sdk/src/index.ts` (schemas + descriptions) and
`apps/mcp/src/server.ts` (handlers + scopes).

- **`add_decision_relation`:** already wired and already accepts any `entityType` including
  `goal`/`project`; a `goal` link inserts successfully today. **Verify end to end** that an
  agent can link a decision to an objective and that the link then appears (hydrated) in
  `get_decision`. Update the tool description — currently
  `"only 'task' is resolvable today"` and `"project/goal/context are reserved"` — to state
  that `goal`, `project`, and `task` now resolve, and that `key_result`/`context` remain
  unresolved. Keep copy em-dash-free.
- **`get_decision`:** returns `DecisionDetail`, so it inherits the hydrated relation labels
  automatically once the service change lands. No handler change beyond the DTO flowing
  through.
- **`get_objective` / `get_project`:** these delegate straight to
  `objectiveService.getObjective` / `projectService.getProject`. Once those return
  `relatedDecisions`, the agent sees related decisions with no handler change. This makes
  the reverse edge queryable by agents, which is the competitively distinctive part.
- **Scopes:** unchanged. `add_decision_relation` is `decisions:write`; reading related
  decisions on an objective/project rides the existing `objectives:read` / `projects:read`
  scopes since it is part of those detail responses.

## 8. Web UI

- **`decision-detail-sheet.tsx` relations section (`RelationsSection`).** Today it only
  builds a task picker (`linkedTaskIds`, `available = tasks.filter(...)`, hardcodes
  `entityType: 'task'` in `onAdd`). Generalize it:
  - Fetch objectives and projects alongside tasks (the sheet already fetches members and
    tasks once per open; add `api.listObjectives` and `api.listProjects` the same way, each
    only when the corresponding capability is enabled — section 10).
  - Offer up to three pickers (Task, Objective, Project), each filtered to entities not
    already linked. Pass the chosen `entityType` through `onAdd` instead of hardcoding
    `'task'`.
  - Render existing relations using the hydrated `label`/`targetStatus` from the server, so
    the badge shows `Goal: Grow signups` rather than a raw uuid. `ENTITY_TYPE_LABELS`
    already has the labels including `Goal` and `Project`.
- **Objective detail sheet (`objective-detail-sheet.tsx`).** Add a "Decisions" section
  (heading + list) rendering `detail.relatedDecisions` with status pills reusing
  `DECISION_STATUS_LABELS`/`DECISION_STATUS_TONE`. Clicking a decision should open the
  decisions surface (link to `/decisions`; deep-linking to a specific decision is a nicety,
  match the dashboard's existing `/decisions` link behavior). Empty state:
  `No decisions linked to this goal yet.`
- **Project detail page (`app/(app)/projects/[id]/page.tsx`).** Add a project-level
  "Decisions" section (project-level links from `detail.relatedDecisions`). Card-level
  decision links already render on each card via the item detail sheet; keep the two
  visually distinct ("Decisions affecting this project" vs. per-card links).
- The decisions surface itself is a list plus the detail sheet (there is no per-decision
  page), so all decision-side UI work is in `decision-detail-sheet.tsx`.

## 9. Dashboard signals (E3)

Builds on the existing capability-aware dashboard (`app/(app)/dashboard/page.tsx`), which
already fetches decisions and objectives in parallel, gates on
`showDecisions`/`showObjectives`, and polls every 20s.

- **Open decisions on at-risk objectives.** The dashboard already lists objectives with
  their `status` (`at_risk` is an `objective_status` value). Cross-reference objectives with
  `status === 'at_risk'` against decisions linked to them (`entityType: 'goal'`) whose
  status is not terminal (`proposed`/`under_review`). Surface a small banner or list:
  "N open decisions on at-risk goals." Because key results have no status field, "at-risk
  key result" is expressed at the **objective** level in slice 1 (an objective goes
  `at_risk` manually or via low rollup); a true per-KR risk signal is deferred with O1.
- **Projects with unresolved `proposed` decisions.** Count projects that have a
  project-level linked decision still in `proposed`. Show as a stat or a line item linking to
  the project.
- Keep E3 to one or two additive cards/banners; do not restructure the dashboard. Reuse the
  existing alert-banner pattern (the `needsReview` / `noIntegrations` banners). All signal
  data should come from the already-fetched decision/objective lists plus the new reverse
  edges, avoiding extra requests where possible.

## 10. Capability gating

Relations must only offer entity types whose capability is enabled. `CAPABILITY_KEYS` =
`[tasks, decisions, projects, context, objectives]`, and
`capabilitiesForWorkspace` returns `{tasks, decisions, projects, objectives, context}`.

- **Decision relations picker:** show the Objective picker only when `capabilities.objectives`
  is on; the Project picker only when `capabilities.projects` is on; the Task picker only when
  `capabilities.tasks` is on. Read `capabilities` from `useActiveWorkspace()` in the sheet
  (the dashboard already does this). Fail-open on unknown (null) capabilities, matching the
  dashboard/nav convention (`?? true`).
- **Reverse "Decisions" sections** on objective/project pages should render only when
  `capabilities.decisions` is on. If Decisions is off for a workspace, do not show a
  Decisions section there at all.
- **API side:** the objective/project detail endpoints run their own area gate. When folding
  `relatedDecisions` into those responses, additionally gate the reverse-decision data on the
  decisions capability server-side (return an empty `relatedDecisions` array when decisions
  is off) so a disabled capability never leaks decision titles through the objectives/projects
  gate.

## 11. Copy considerations

Per the standing rule (`CLAUDE.md`, MEMORY): **no em-dashes in user-facing copy;** use a
period, comma, colon, semicolon, or parentheses. Use the en-dash `–` only for empty-value
cell placeholders (`EMPTY` in `decision-meta.ts`).

- Section headings: `Related` (existing), `Decisions` for the reverse sections.
- Empty states (em-dash-free): `No decisions linked to this goal yet.`,
  `No decisions affecting this project yet.`, `Nothing linked yet.` (existing).
- Picker placeholders: `Link a goal…`, `Link a project…`, `Link a task…` (existing).
- Dashboard signal copy: `N open decisions on at-risk goals.`,
  `N projects have proposed decisions awaiting a call.`
- Where a linked entity was deleted and cannot be resolved, render the en-dash placeholder,
  not a raw id, in table/stat contexts.

## 12. Testing

- **Reverse-lookup correctness.** `objectiveService.listRelatedDecisions` and
  `projectService.listRelatedDecisions` return exactly the decisions linked to a given
  objective/project and nothing from other entities or other workspaces (workspace-scoping
  is load-bearing since `entityId` is not an FK).
- **Hydration.** `getDecision` resolves `goal` -> objective title/status and
  `project` -> project name/status; a relation to a deleted entity yields `label: null`
  without throwing.
- **Dedup / idempotency.** Linking the same decision-objective pair twice is a no-op (the
  existing `decision_relations_decision_entity_uq` index + `onConflictDoNothing`), and
  `addRelation` returns the existing row.
- **Capability-off hiding.** With `objectives` off, the decision relations picker omits the
  Objective option; with `decisions` off, objective/project detail responses return empty
  `relatedDecisions` and the UI hides the section.
- **MCP end to end.** An agent with `decisions:write` links a decision to an objective via
  `add_decision_relation` with `entityType: 'goal'`; the link then appears hydrated in
  `get_decision`, and as a related decision in `get_objective`.
- **Index.** Sanity-check that the reverse query uses `decision_relations_entity_idx`
  (explain, or at least that the migration created it).
- Follow the existing core service test patterns (testcontainers Postgres) already used for
  decisions/objectives/projects.

## 13. Ordered tracer-slice breakdown (effort S / M / L)

1. **Slice 1 — decision ↔ objective, end to end (M).** Reverse index migration (S) +
   `getDecision` goal hydration (S) + `objectiveService.listRelatedDecisions` folded into
   `getObjective` (S) + Objective picker in `decision-detail-sheet.tsx` (M) + "Decisions"
   section on the objective detail sheet (S) + capability gating for the objective picker/
   section (S). Verify the MCP `goal` path works and fix the tool description (S). This is
   the smallest complete vertical slice and the pause-for-feedback point.
2. **Slice 2 — decision ↔ project reverse roll-up (S/M).** `getDecision` project hydration
   + `projectService.listRelatedDecisions` (project-level) folded into `getProject` +
   Project picker in the decision sheet + project-level "Decisions" section on the project
   page. Card-level links already exist, so this is mostly the project-level roll-up and one
   more picker.
3. **Slice 3 — strategy signals (S/M).** The two dashboard signals (open decisions on
   at-risk goals; projects with proposed decisions), reusing already-fetched data and the
   existing banner pattern.
4. **Slice 4 (optional fast-follow) — first-class key results (M).** Only if O1 resolves
   toward KR linking: `ALTER TYPE ... ADD VALUE 'key_result'`, a KR resolver in
   `getDecision`, a KR picker, and a derived per-KR risk signal. Deferred by default.

## 14. Cross-theme dependencies and shared entities

- **Shared entity:** `decision_relations` (polymorphic) is the single spine for all of this.
  The reverse index and the reverse-lookup service functions introduced here are shared
  infrastructure.
- **Theme C (supersession propagation)** consumes the reverse lookups: when a decision is
  superseded/deprecated, it must notify stakeholders of related projects/objectives, which
  requires exactly the `(entity_type, entity_id)` reverse resolution built here. Building E
  first means C plugs into `listRelatedDecisions`-style helpers rather than adding its own.
- **Theme D (reporting/strategy metrics)** consumes the same reverse edges to report
  decision-to-strategy coverage and to build the decision register with laddering. The
  hydrated relation labels from `getDecision` feed the register export directly.
- Flag for both C and D: if a third consumer of reverse resolution lands, promote the join
  to `decisionService.listDecisionsForEntity(entityType, entityId)` (section 5) so all
  themes share one implementation.

## 15. Open questions / decisions for the user

- **O1 — First-class key results? RESOLVED 2026-07-11: yes.** Decisions link to individual
  key results as a first-class entity, not only to the parent objective. This adds the
  `key_result` enum value (one-way `ALTER TYPE`, see section 4), a KR picker, and read-side
  hydration of KR title/progress. Since KRs have no `status`, "at risk" for a KR is derived
  from its parent objective's status in E3. Slice 1 now includes decision to objective
  **and** decision to key result linking end to end.
- **O2 — Auto-suggest goal link when linking a project?** A project can already ladder up to
  a key result via `key_result_projects`. When a user links a decision to a project, should
  we suggest also linking it to that project's objective(s) (transitively via the KR)? Nice
  strategy-graph completeness, but adds UI and can surprise users. Recommendation: no
  auto-link in slice 1; consider a non-committal suggestion later. **Decision needed.**
- **O3 — Project-level vs card-level decision links.** We now have both card-level
  (`project_item`) and project-level (`project`) decision links. Confirm the product wants
  both surfaced distinctly, or whether the project page should union them into one
  "Decisions" list. Recommendation: keep them distinct with clear labels.
- **O4 — Reverse index scope.** `decision_relations_entity_idx` on
  `(entity_type, entity_id)` serves the reverse lookups. Confirm we do not also need
  `(entity_id)` alone (we do not, given queries always filter by type). Low stakes.
- **O5 — Deep-linking to a decision.** The decisions surface has no per-decision page (list
  + sheet only). Reverse "Decisions" sections link to `/decisions`; confirm that is
  acceptable for slice 1 or whether a `?decision=<id>` deep link that opens the sheet is
  wanted.
