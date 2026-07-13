# Agent visibility capability: market landscape and enhancement roadmap

Status: proposal (2026-07-12). Research inputs: deep market and regulatory research
(23 claims verified against primary sources, July 2026) plus a full map of the existing
agent runtime, audit, and usage implementation. Companion docs:
`docs/agent-tasks-and-auditability.md` (the original M5 plan; Phases 1 to 4 shipped,
Phases 5 and 6 are absorbed into Theme B below) and `docs/architecture.md`.

Customer feedback: beta customers in audit-heavy, highly governed industries want
connected-agent visibility and understandability. Business teams (not engineers) must
be able to track, monitor, and audit what any connected agent did and why, regardless
of which framework or vendor built the agent. Five goals drive this roadmap:

1. A complete, trustworthy record: every action by every actor (agent or human) is
   captured, attributed, and tamper-evident.
2. Business-readable understanding: plain-English narratives and timelines, not trace
   waterfalls.
3. Governance controls: agent registry, least-privilege access, approval checkpoints.
4. Auditor-ready outputs: retention, verifiable exports, framework mappings.
5. Proactive monitoring: know when an agent behaves off-pattern before an auditor asks.

## 1. Market landscape (verified findings)

### Regulation already demands agent activity records

- EU AI Act Article 12(1): high-risk AI systems must technically support automatic
  event logging over the entire lifetime of the system. Article 12(2) ties logging to
  traceability for three purposes: identifying risk situations or substantial
  modifications, post-market monitoring, and monitoring of operation by deployers
  (Article 26(5)). Deployers, meaning our customers, carry monitoring obligations they
  will push down onto their tools.
- FINRA Rule 4511: books and records with no specified retention period must be kept
  at least six years. That is the default retention floor for regulated financial
  customers.
- SEC Exchange Act Rule 17a-4: electronic recordkeeping systems must maintain a
  complete time-stamped audit trail covering all modifications and deletions, or use
  WORM storage, and must be able to readily download a record together with its audit
  trail. Rule 17a-4(b)(4): business electronic communications (internal and external)
  are retained at least three years, first two easily accessible. Agent-generated
  business communications at broker-dealers fall inside this scope.

Implication: "show me everything the agent did, prove it was not altered, and export
it with its audit trail" is not a nice-to-have; it is the literal shape of the rules.

### Platform vendors are racing to govern agents at the identity layer

- Microsoft Entra Agent ID: purpose-built identity framework extending Entra to AI
  agents (authentication, authorization, governance, lifecycle). All agent
  authentication and activity is logged for compliance and audit, with dedicated agent
  sign-in and audit logs. Explicitly vendor-agnostic: third-party agents (AWS Bedrock,
  n8n) integrate via an auth SDK sidecar or workload identity federation.
- ServiceNow AI Control Tower: a centralized console to monitor and manage AI agents
  built by any vendor, with integrated GRC features (security, privacy, compliance
  monitoring across the AI lifecycle) aimed at compliance and risk audiences, plus an
  enterprise-wide agent inventory showing all connected agents and what each is doing.
- Salesforce Einstein Trust Layer: audit trail collects timestamped metadata for the
  entire generative AI interaction (prompt, original unfiltered LLM response, toxicity
  scores, user feedback), with step-level traceability through each pipeline stage.
  Verified gap: data masking is currently disabled for Agentforce agents and only
  available for embedded AI features. Even the giants have seams between their agent
  offerings and their trust controls.

### Developer tooling has the data model; none of it serves business teams

- OpenTelemetry GenAI semantic conventions define framework-agnostic span attributes
  for agent activity (operation names including `invoke_agent`, `execute_tool`,
  `create_agent`, `plan`; token usage; agent identity attributes `gen_ai.agent.id`,
  `.name`, `.version`; tool definitions). Still at "Development" (pre-stable) maturity,
  so treat as a moving target. Critically, the spec mandates that prompt/completion
  content is NOT captured by default, opt-in only; default OTel telemetry will lack
  message content unless deliberately enabled.
- Langfuse audit logs capture actor identity (user or API key), action, timestamp,
  and org/project context per event, and record complete before/after state as JSON
  for modifications, enabling diff-level reconstruction. That before/after pattern is
  the bar for change auditing.

### Standards for agent identity and audit records are forming now

- IETF individual draft `draft-klrc-aiagent-auth` (co-authored by AWS, Zscaler, Ping
  Identity, OpenAI, Okta staff) profiles existing standards (WIMSE, OAuth 2.0) for
  agent auth. It mandates durable audit logs for agent authorization activity with a
  minimum record schema: authenticated agent identifier, delegated subject (user or
  system), resource or tool accessed, action requested and authorization decision,
  timestamp, and a transaction/request correlation identifier. It also calls static
  API keys an antipattern: agents should hold short-lived credentials bound to a
  unique agent identifier.
- Our audit_events rows already carry most of that minimum schema. The gaps are the
  delegated subject (who the agent acted on behalf of) and a correlation id.
  Our OAuth connect flow already aligns with the short-lived-credential direction;
  static agent keys remain the compatibility path.

### Where the whitespace is

Identity platforms govern agents at the IT layer (sign-ins, entitlements). Developer
tools trace agents at the span layer (for engineers). GRC platforms inventory agents
at the org layer. Research found no verified evidence (as of July 2026) that any
work-management incumbent (Asana, Atlassian, Monday, Notion) offers business-facing
agent audit: a compliance-grade, human-readable record of what agents actually did to
the work itself: the tasks, decisions, objectives, and projects. That record-of-work
layer is exactly what Palouse already owns.

## 2. Positioning

Palouse becomes the auditable system of record for agent work. We do not compete with
Entra Agent ID or Control Tower at the identity/inventory layer, and we do not compete
with LangSmith at the trace layer. We sit where the work lives: any agent, built with
any framework, connecting over MCP or OTLP, produces a business-readable,
tamper-evident, exportable account of everything it did alongside humans. We already
have the hard parts: an audit spine that logs every MCP tool call, dual attribution on
every entity, a handoff-as-trace model with narrative steps, and a cost ledger with
immutable price snapshots. The roadmap closes the loop: record everything, prove it,
govern it, explain it, and hand it to the auditor.

## 3. Enhancement themes

### Theme A: Complete the record (goal 1)

Today only creations and MCP calls are audited, MCP events target the agent rather
than the entity acted on, and human UI actions are invisible.

- **A1. Entity-targeted audit events.** Fix `audit_events.targetType/targetId` to
  reference the entity acted upon (task, decision, objective, project) instead of the
  agent itself; keep the actor columns as the agent. Add audit writes for update
  mutations (`update_task`, `update_decision`, etc.), not just creates. This is the
  enabling change for "show me everything that touched this decision."
- **A2. Human action parity.** Log user-initiated mutations from the web UI and REST
  API into the same `audit_events` spine (service-layer funnel; the `actor` parameter
  already flows through `packages/core` services). One unified who-did-what timeline;
  auditors do not care which species did the edit.
- **A3. Before/after change payloads.** For update events, store changed-field diffs
  (old and new values) in the audit payload, the Langfuse pattern. Sanitization rules
  from the existing `auditToolCall` (truncation, token stripping) apply.
- **A4. Agent comment attribution.** Add `authorAgentId` to task and decision
  comments so agent comments are directly attributed instead of inferred from the
  audit log.
- **A5. Handoff lifecycle into the compliance log.** Replicate compliance-relevant
  handoff transitions (claimed, completed, failed, review decisions) from
  `handoff_events` into `audit_events`, as the original M5 plan intended.
- **A6. Delegation and correlation fields.** Add `onBehalfOfUserId` (from OAuth token
  claims or handoff `requestedByUserId`) and a `requestId` correlation id to audit
  events, closing the gap against the IETF draft's minimum record schema.

### Theme B: Prove the record (goals 1, 4)

Absorbs Phases 5 and 6 of `docs/agent-tasks-and-auditability.md`, which are fully
designed there (schema, advisory-lock write funnel, verification, export formats) and
remain unbuilt.

- **B1. Tamper-evident hash chain.** Per-workspace `seq`/`prevHash`/`hash` columns on
  `audit_events`, single `appendAuditEvent` funnel, backfill CLI, `GET /v1/audit/verify`
  plus `palouse verify-audit`. Maps directly to SEC 17a-4's "complete time-stamped
  audit trail" alternative to WORM.
- **B2. Audit query API.** `GET /v1/audit/events` (paginated, filterable by actor,
  entity, action, time range). Today compliance review requires direct DB access;
  this endpoint powers everything in Theme D.
- **B3. Auditor-ready exports.** Per-handoff Activity Report PDF and CSV; workspace
  audit package zip (chained JSONL, usage CSV, `verification.json`, README documenting
  the hash recipe so an auditor can independently re-verify). SEC 17a-4 requires
  downloading records together with their audit trail; the package is that download.
- **B4. Retention policy and legal hold.** Workspace-level retention setting with a
  regulated preset (six-year floor per FINRA 4511); audit events and usage rows are
  excluded from workspace-deletion flows while a hold is active; document what is and
  is not deletable.

### Theme C: Govern the agents (goal 3)

- **C1. Agent registry enrichment.** Extend the agents area into a compliance-grade
  registry: accountable human owner, vendor/framework, purpose description, model(s)
  observed (derivable from `llm_generations`), environment, risk tier, next review
  date. This is the agent inventory that Control Tower sells and EU AI Act deployer
  monitoring implies; ours is grounded in observed activity, not self-declaration.
- **C2. Access transparency.** Per-agent view of exactly what it can do (key scopes,
  OAuth grants, capability gates), what it actually did (scope usage from audit
  events), and the delta: wildcard or over-provisioned scopes flagged with
  least-privilege suggestions ("this agent has `*` but has only ever used
  `tasks:read`, `tasks:write`").
- **C3. Credential hygiene.** Optional key expiry and rotation reminders; surface
  last-used and stale keys; steer regulated workspaces toward the OAuth flow
  (short-lived credentials, per the IETF draft direction) while keeping static keys
  as the compatibility path.
- **C4. Approval checkpoints.** Per-workspace policy for which agent actions require
  human review before taking effect, generalizing the existing handoff
  `review_required` gate: e.g. agent-created decisions land as `proposed` requiring
  accept (already true), agent task completions require review, destructive updates
  held. Policy lives on the workspace; enforcement in the service layer; queue of
  pending approvals reuses the reviews UX.

### Theme D: Explain the activity (goals 2, 5)

- **D1. Workspace activity feed.** A business-readable, filterable timeline (by agent,
  person, entity, action type, date) over the audit query API. Nav-level page, the
  visible heart of the capability. Plain-English rendering per action type ("Scout
  updated the due date on 'Prepare Q2 filing' from Jul 20 to Jul 22").
- **D2. Entity-level history.** An "Activity" section on task, decision, objective,
  and project detail views: every audited action that touched this record, human and
  agent, with diffs from A3. Depends on A1 entity targeting.
- **D3. Agent digest narratives.** Extend the existing `narrateHandoff` module to
  agent-level and workspace-level periods: "what your agents did this week" digest
  (in-app card plus optional email through the notification rails being built for the
  decisions roadmap Theme B4).
- **D4. Behavior signals.** Dashboard signals for anomalies computed from audit and
  usage data: activity outside the agent's normal hours, volume spikes, first use of
  a tool or scope, failure-rate spikes, cost spikes against the rollup baseline.
  Reuses the strategy-signals dashboard pattern. Heuristic thresholds first; no ML
  dependency.
- **D5. Live status.** "What is running right now": agents holding active claims,
  current step title, last heartbeat. Data already exists on `agent_handoffs` and
  `handoff_steps`; this is a read-side view.

### Theme E: Meet the frameworks (goals 4, 5)

- **E1. Content capture policy.** OTel telemetry excludes prompt/completion content by
  default per spec. Add an explicit workspace-level opt-in for content capture on
  OTLP ingest and MCP payloads, with masking rules, so regulated customers choose
  their exposure deliberately. Ship with capture off; the Salesforce
  masking-gap finding shows how badly it reads when trust controls lag the agent
  surface.
- **E2. Standards conformance.** Track the OTel GenAI semconv as it stabilizes (attr
  renames are likely pre-1.0) and keep the OTLP mapper current; document our audit
  record's conformance to the IETF draft minimum schema once A6 lands.
- **E3. Compliance mapping for buyers.** A short, honest control-mapping document
  (and later a trust page): which product features support which EU AI Act Article 12,
  SOC 2, and SEC/FINRA recordkeeping expectations. Sales enablement for security
  reviews; also keeps us from over-claiming.
- **E4. External archive streaming.** Scheduled export of the audit stream to
  customer-owned storage (S3 with object lock for WORM, SIEM webhook) for customers
  whose policies require records in their own systems. Cloud-tier feature per the
  existing `cloud/audit-export` sketch.

## 4. Suggested sequencing (tracer-bullet slices)

Each slice is thin end-to-end, shippable, and pausable for feedback.

1. **Complete record + activity feed** (A1, A2, B2, D1): entity-targeted
   audit events, create + update logging on all human and agent mutations (A2 in
   full, per the 2026-07-13 decision below), the audit query API, and the workspace
   activity feed page (nav label "Activity"). One slice makes the capability visible
   and useful immediately, with a complete rather than partial timeline from day one.
   (M/L)
2. **Hash chain + verification** (B1): already fully designed in the M5 plan; adds
   the "Integrity verified" badge to the feed and reports. The single strongest
   regulated-industry differentiator per dollar of effort. (M)
3. **Entity history + diffs** (A3, A4, D2): before/after payloads, comment
   attribution, and the per-entity Activity section. (M)
4. **Auditor exports** (B3): Activity Report PDF, CSVs, audit package zip with
   independent verification instructions. First demo-able "hand this to your
   auditor" moment. (M)
5. **Registry + access transparency** (C1, C2, C3): enriched agent registry, granted
   vs used scopes, credential hygiene. (M)
6. **Approval checkpoints** (C4): workspace approval policies over the existing
   review machinery. (M/L)
7. **Digests + behavior signals + live status** (D3, D4, D5): the proactive layer,
   most valuable once volume exists. (M)
8. **Retention + compliance mapping** (B4, E3): policy plumbing and the buyer-facing
   mapping doc. (S/M)
9. **Content capture policy + external archive** (E1, E4): opt-in content capture
   with masking; cloud archive streaming. (L)

Slices 1 to 3 form the credible core ("complete, provable, explainable"); a beta
customer conversation is warranted after slice 3, and again after slice 4 with the
export artifact in hand.

Capability gating: add a new top-level `audit` capability key (nav-level area like
decisions/objectives/projects), rendered in the nav as **"Activity"** (the
`CAPABILITY_LABELS` map already decouples key from label), gating the activity feed,
entity history, and exports. It **defaults on**, matching the uniform default-enabled
convention (`packages/shared/src/capability.ts`); recording to `audit_events` is never
gated, so the toggle controls visibility surfaces only. Per-feature flags (signals,
digests, approvals) via the `config` JSONB pattern the decisions plans converged on,
to avoid enum churn.

## 5. Constraints and gotchas to carry into design

- **Audit writes are the hot path.** `appendAuditEvent` with the per-workspace
  advisory lock serializes writers per workspace; fine at current volume, but slice 1
  increases event volume (updates + human actions) before slice 2 adds the chain.
  Keep the funnel async-safe and measure before adding the lock.
- **Backfill honesty.** Pre-chain audit rows get backfilled into the chain in
  seq/at order; an auditor should be told the chain start date. `verification.json`
  should carry the genesis timestamp.
- **We only see what agents show us.** Palouse observes MCP tool calls, self-reported
  steps/usage, and OTLP spans. We cannot attest to what an agent did outside Palouse.
  Copy and compliance mapping must be precise: this is a record of agent actions in
  the workspace, not total agent behavior. Over-claiming here is a trust killer in
  exactly the industries we are targeting.
- **Self-reported data is labeled, not trusted.** The existing cost engine already
  stores self-reported cost separately from computed cost; extend that discipline to
  steps and usage everywhere in the UI (source badges: MCP-reported vs OTLP vs
  observed).
- **OTel GenAI conventions are pre-stable.** Expect attribute churn; keep the mapper
  tolerant of legacy names (it already handles `prompt_tokens`/`completion_tokens`).
- **Content is sensitive by default.** Do not widen payload capture without E1's
  explicit opt-in and masking; the current sanitizer (truncation, claim-token
  stripping) stays the floor.
- **Retention vs deletion tension.** Workspace deletion flows and GDPR-style erasure
  requests will collide with retention holds; B4 needs a deliberate policy decision,
  not an implementation default.
- **Unverified claims from research (do not build on these without re-checking):**
  the MCP spec's OAuth 2.1 profile details, and Singapore CSA's agentic-AI security
  addendum requiring agent registries. Both verification passes failed on session
  limits, not on contrary evidence; re-verify at design time if either becomes
  load-bearing.

## 6. Per-theme implementation plans

To be written as standalone plans under `docs/plans/` (pattern:
`docs/plans/agent-visibility-theme-a-record.md` etc.), one at a time as themes are
picked up, following the 15-section template used by the decisions theme plans. All
grounded in the code as of 2026-07-12; current migration head is
`0019_strategy_linkage.sql`; migration numbers assigned at implementation time.

Resolved decisions (2026-07-13, Jonathan):

1. **Naming.** The nav-level area is **"Activity"** (business-readable; the feed
   records both human and agent actions). Internal capability key stays `audit`;
   compliance framing ("Audit package", "Integrity verified") lives on the export and
   verification surfaces, not the everyday nav label.
2. **Human-action logging (A2): all mutations from day one.** Slice 1 wires every
   human web/REST mutation into the audit spine, not just agent-adjacent surfaces, so
   the first feed is a complete timeline rather than a partial one. This enlarges
   slice 1 (M → M/L); accepted deliberately.
3. **Approval checkpoints (C4): per-workspace policy first.** Ship the workspace-level
   policy over the existing review machinery; design the schema so per-agent overrides
   can be added later without migration churn. (Slice 6; revisit at Theme C design.)
4. **Retention (B4): configurable-only with an opt-in six-year preset.** Default
   behavior is unchanged; regulated workspaces opt into a documented six-year FINRA
   4511 preset. This avoids forcing the retention-vs-deletion tension (GDPR erasure,
   workspace deletion) onto non-regulated customers.
5. **`audit` capability defaults on.** Matches the uniform default-enabled convention;
   existing workspaces see the Activity feed immediately and admins can hide it.
   Recording to `audit_events` is always on regardless of the toggle.
