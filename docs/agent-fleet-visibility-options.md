# Agent fleet visibility: gateway question and options assessment

Status: proposal (2026-07-14; F6 added 2026-07-15). Candidate slices F1 to F4 and
F6 are tracked in Specboard under the Agent Tracking release; Specboard owns scope
and status, this document is the assessment reference. Research inputs: a codebase
map of the MCP and audit implementation as of v0.21.0, plus a market survey of MCP
gateways, agent observability platforms, and Anthropic-native telemetry (sources
in section 7).
Companion docs: `docs/agent-visibility-roadmap.md` (themes A to E, slices 1 to 3
shipped) and `docs/plans/agent-visibility-implementation.md` (execution tracker).

## 1. The question

The team asked: how do we make sure we are capturing what different agents across a
customer's business are doing, how they tackle tasks, and how the customer gets
end-to-end visibility? Concretely: would enabling Palouse as an MCP gateway solve
this, or is there a better shape?

### The north star this must serve

The ultimate goal for Palouse is to become a true observability and understanding
layer for the business: how employees work, how automations execute, how agents
operate, how to improve these systems, and how all of it ladders back to business
objectives. A future version of process mining and intelligence that the least
technical team member can read. The beachhead market is unchanged from the roadmap:
audit-heavy, highly governed industries, where "show me everything the agent did,
prove it was not altered, and export it with its audit trail" is the literal shape
of the rules (EU AI Act Art. 12, SEC 17a-4, FINRA 4511; roadmap §1). Every option
below is judged against both: does it serve the understanding layer, and does it
produce records an auditor will accept?

Two consequences of that framing:

1. Classic process mining (Celonis, UiPath Process Mining, Microsoft Process Advisor)
   works by extracting event logs out of systems of record (ERP, CRM) and
   reconstructing the process. Palouse is in a stronger position: it already **owns a
   native, tamper-evident event log** (`audit_events`) attached to the work itself
   (tasks, decisions, objectives, projects), with human and agent actors
   distinguished on every row. The strategic job is to widen what flows into that
   log and deepen how it is explained, not to become network plumbing.
2. "End-to-end visibility" needs honest vocabulary. We capture three classes of
   activity, and the UI and exports must label them (roadmap §5 already demands
   this discipline):
   - **Observed**: actions Palouse itself executed or received (MCP tool calls,
     web/REST mutations). Strongest class; we can attest to these.
   - **Reported**: telemetry or self-reports the agent chose to send (OTLP spans,
     steps, `record_activity`-style logs). We can attest they were received and not
     altered since, not that they are complete.
   - **Absent**: anything an agent did in a system that never told us. No
     architecture below eliminates this class; an in-path gateway shrinks it only
     for traffic routed through the gateway.

   For audit-heavy customers this taxonomy is not cosmetic: it is the difference
   between a record we can attest to and one the customer attests to. Regulated
   recordkeeping already runs on the second kind (firms self-report their books;
   the regulator's demand is integrity, completeness controls, and export), so
   "reported, but hash-chained on receipt and provably unaltered since" is a
   perfectly defensible evidentiary class as long as we never blur it with
   "observed."

## 2. Where Palouse stands today

- **Palouse is an MCP server, not a gateway.** Agents connect in with scoped keys
  (`apps/mcp/src/auth.ts`, `apps/mcp/src/server.ts`; 43 tools, stateless streamable
  HTTP at `mcp.palouse.ai/mcp`). Every mutation lands in the per-workspace
  hash-chained `audit_events` spine (`packages/core/src/audit/chain.ts`), human and
  agent alike, with entity-level history and diffs (slices 1 to 3, shipped
  v0.21.0).
- **There is already an OTLP beachhead, but it is usage-shaped.**
  `POST /v1/otlp/v1/traces` (`apps/api/src/routes/otlp.ts`) accepts OTLP/JSON GenAI
  spans, rate-limited per agent key, and writes an `otlp.ingest` audit event. But
  the mapper (`packages/core/src/usage/otlp.ts`) extracts token/cost data into
  `llm_generations` and **rejects any span it cannot correlate to an active
  handoff**. An agent doing work not tied to a Palouse handoff has nowhere to land
  its telemetry. That rejection rule is the single clearest gap between today and
  fleet-wide visibility.
- **Known limits** (roadmap A6 and §5): no `requestId`/`traceId` correlation fields
  on audit events, no delegated-subject (`onBehalfOfUserId`) field, no capture of
  work done in other systems, and the standing caveat "we only see what agents show
  us."

## 3. The option space

### Option 1: Palouse as an in-path MCP gateway

Agents would point at Palouse instead of their real MCP servers; Palouse proxies
every tool call downstream and records it.

What it buys: transport-level completeness for MCP traffic specifically. Every tool
call an agent makes through the gateway is observed, not reported.

What it costs:

- **An availability SLA over the customer's entire agent fleet.** If the gateway is
  down, the customer's agents stop working, not just their audit trail. That is an
  infrastructure product with infrastructure expectations (latency budgets,
  multi-region, on-call posture) that none of our current surfaces carry.
- **Credential custody.** The gateway must hold and forward auth for every
  downstream MCP server (Salesforce, GitHub, internal tools). That is a security
  scope expansion we have deliberately avoided.
- **A crowded, consolidating market.** MintMCP (SOC 2 SaaS), Lasso Security, IBM
  ContextForge (OSS), Obot (k8s-native), Cloudflare AI Gateway with MCP portals,
  Kong AI Gateway, TrueFoundry; Palo Alto Networks completed its acquisition of
  Portkey in May 2026. Competing here means fighting Cloudflare and Palo Alto on
  their turf with none of their distribution.
- **Shallow data relative to the north star.** A gateway sees method names,
  arguments, and latencies. It does not see reasoning, does not see non-MCP actions
  (raw API calls, browser use, file edits), and produces exactly the
  trace-waterfall data the roadmap says business users do not want. It moves us
  toward network observability and away from work understanding.
- **It is not what the audit rules actually ask for.** SEC 17a-4 and EU AI Act
  Art. 12 demand complete time-stamped records, tamper-evidence, retention, and
  export with the audit trail. They do not require path interception. Gateways in
  regulated shops are bought by security teams for inline DLP and blocking, a real
  but different job; the recordkeeping obligation is satisfied by the event log,
  which we already own.

### Option 2: buy or partner for the gateway layer

Let customers who need path-interception run MintMCP/Lasso/Cloudflare, and make
Palouse the place that data becomes understandable. Viable, and compatible with
Option 3: gateways increasingly emit OpenTelemetry, so a customer's gateway can
simply be another telemetry source pointed at Palouse. No build required now; a
named integration could come later if one vendor dominates.

### Option 3: Palouse as the telemetry sink (OTel ingest, expanded)

The industry is converging on OpenTelemetry GenAI semantic conventions as the common
wire for agent activity: the spec now covers agent and MCP spans (`invoke_agent`,
`execute_tool`, `gen_ai.agent.id`, MCP method/session attributes; still pre-stable),
and Claude Code and the Claude Agent SDK export it natively (tool spans, token and
cost metrics, content opt-in and redacted by default). AWS Bedrock AgentCore is
OTel-compatible; LangSmith, Langfuse, and the gateways all speak it.

Palouse already has the endpoint, the auth, the rate limiting, and the mapper. The
move is to promote it from a usage lane to an activity lane: accept agent-session
and tool-call spans that are **not** correlated to a handoff, attribute them to the
sending agent, and surface them as reported activity in the feed, entity history
(where correlatable), digests, and exports.

Why this fits the north star best:

- **Zero agent code changes for the Claude ecosystem**: "set
  `OTEL_EXPORTER_OTLP_ENDPOINT` to Palouse" is the whole integration, and it is
  vendor-neutral for everything else in the fleet.
- **No single point of failure**: telemetry export failing never blocks an agent.
- **It feeds the understanding layer we already built**: the same plain-English
  feed, hash-chained record, and export machinery now covers what agents did
  elsewhere, clearly labeled as reported rather than observed.
- **It is the process-mining posture**: process intelligence is built on event-log
  ingestion plus interpretation, not on sitting in the request path.

### Option 4: push-based self-reporting

A generic `record_activity` MCP tool (and later, webhook ingest for automation
platforms) lets any agent or automation log work performed in systems Palouse
cannot see: "filed the quarterly report in NetSuite," "merged PR #412." Cheap to
build, works for agents with no OTel support, and covers the "automations" leg of
the vision (n8n, Zapier, Power Automate can call a webhook). Weakest evidentiary
class (self-reported), which is fine as long as the label is honest; the cost
engine already models exactly this split (self-reported vs computed cost).

### Comparison against the north star

| | In-path gateway | Buy/partner | OTel sink | Self-report |
|---|---|---|---|---|
| Visibility depth | Transport-level MCP only | Depends on vendor | Deep (sessions, tools, reasoning metadata) | Whatever the agent says |
| Covers non-MCP actions | No | No | Yes (any instrumented runtime) | Yes |
| Business-readable by default | No (trace data) | No | Via existing Activity surfaces | Via existing Activity surfaces |
| Availability risk to customer | High (in path) | Vendor's problem | None | None |
| Build cost | L, plus ongoing infra posture | None now | M (endpoint exists) | S |
| Competitive field | Crowded, consolidating | n/a | Open (no one owns the business-facing sink) | Open |
| Fit with "system of record for agent work" | Dilutes it | Neutral | Extends it | Extends it |

## 4. Recommendation

**Do not build an in-path MCP gateway now.** Palouse's differentiated position,
already argued in the roadmap (§2 positioning, "record-of-work layer"), is the
auditable system of record and understanding layer for agent and human work. No
gateway vendor has the tamper-evident chain tied to business context; no
observability vendor serves non-technical readers. Being in the request path buys
shallow data at the price of an infrastructure SLA and a fight with Cloudflare, Palo
Alto, and Kong.

Instead, run three lanes, cheapest first, all feeding the one audit spine:

1. **Correlation and exports (already roadmapped, do first).** A6 fields
   (`requestId`/`traceId`, `onBehalfOfUserId`) make every audit row joinable with
   external telemetry, and slice 4 exports make the record hand-to-auditor real.
2. **OTel activity ingest (the big lever).** Expand OTLP ingest beyond
   handoff-correlated usage: accept GenAI/MCP semconv agent-session and tool spans,
   store span-grade data in its own table (the `llm_generations` pattern; do not
   push span volume through the advisory-locked `appendAuditEvent` hot path), and
   chain summary-level activity events into `audit_events` with a provenance
   marker. Content capture stays off by default per E1.
3. **Self-reported activity (cheap complement).** `record_activity` MCP tool now;
   automation-platform webhook ingest later. Labeled self-reported everywhere.

**Defer, do not reject, the gateway.** Revisit path-interception only if customer
demand for pre-action policy enforcement (Theme C4 approval checkpoints applied to
external tools) makes it necessary; that is the one job telemetry genuinely cannot
do, because telemetry arrives after the fact. If that demand materializes, the
likelier shape is a scoped MCP "portal" (Palouse fronts a curated set of downstream
servers per workspace) rather than a general-purpose gateway.

## 5. Candidate slices (feeding the existing roadmap)

Sizes use the roadmap's S/M/L convention; detailed plans belong in `docs/plans/`
when picked up.

- **F1. Correlation fields (A6).** `requestId`, `traceId`, `onBehalfOfUserId` on
  `audit_events`; thread through `appendAuditEvent` callers and the MCP layer.
  Prerequisite for joining ingested telemetry to observed actions. (S)
- **F2. Auditor exports (existing slice 4).** Unchanged; proceeds as planned. (M)
- **F3. OTLP activity ingest.** Accept uncorrelated GenAI/MCP spans; new
  span/session storage table; summary events into the chain with provenance
  labels; Activity feed and agent detail render reported activity with a source
  badge; keep the mapper tolerant of pre-stable semconv churn (E2). The audit
  posture is receipt attestation: chain the ingest event (payload digest,
  timestamp, agent key) so exports can prove what was received and when, and that
  it has not changed since. Includes a "connect your agent's telemetry" doc page
  with the three env vars. (M/L)
- **F4. `record_activity` tool.** New MCP tool plus scope, sanitized payload,
  self-reported badge; trivially extends to a REST endpoint for non-MCP
  automations. (S)
- **F5 (deferred). MCP portal / policy gateway.** Only on demonstrated customer
  demand for pre-action enforcement; design would build on C4 approvals. (L)
- **F6. Vendor audit-log ingest for hosted assistants.** Added 2026-07-15; tracked
  in Specboard ("Vendor audit-log ingest (hosted Copilot / ChatGPT / Claude)",
  Agent Tracking release). F3 assumes the customer can point the agent's OTel
  exporter at Palouse; hosted Microsoft 365 Copilot, ChatGPT, and Claude.ai
  sessions have no exporter to configure, and vanilla Copilot use (Word, Outlook,
  Teams, Business Chat) never routes through any custom agent or MCP server, so
  it is all "absent" class today, even after the A2 declarative agent ships.
  Instead, ingest the vendors' own compliance exports: Microsoft Purview
  `CopilotInteraction` records (auto-generated under Audit (Standard), included
  in existing M365 licensing, metadata-only, retrievable via the Office 365
  Management Activity API), with OpenAI's and Anthropic's Compliance APIs as the
  ChatGPT/Claude analogs. Evidence class: reported, vendor-attested; chain on
  receipt per the F3 posture with a distinct provenance marker. Depends on F1
  and F3 (reported-activity storage); sequences after F3. (M)

Sequencing suggestion: F1 folds into or immediately follows slice 4 (F2); F3 is the
next major slice after that; F4 can ride along with either; F6 follows F3.

## 6. Open questions for the team

1. **Provenance in the UI.** Observed / reported / self-reported badges: per-row,
   per-section, or both? The cost engine's computed-vs-self-reported split is the
   in-house precedent.
2. **Span retention and volume.** Span-grade telemetry is high-volume and mostly
   low-value after aggregation. Separate retention for the span table vs the audit
   chain? Does B4's retention policy govern both?
3. **Capability key.** Does ingested fleet activity live under the existing `audit`
   capability ("Activity"), or warrant its own key once volume justifies a
   dedicated surface?
4. **Automations lane.** The vision includes automations (n8n, Zapier, Power
   Automate). Is webhook ingest a near-term F4 extension or a later theme?
5. **Employee-work observability.** The north star includes how employees work.
   In-Palouse human actions are already recorded (A2), but anything broader
   (ingesting human activity from other systems) has surveillance connotations that
   could poison the agent-audit trust story. Proposal: keep human visibility scoped
   to work artifacts (what changed in the workspace), never activity monitoring,
   and say so in the compliance mapping (E3).
6. **Claude-ecosystem gap to watch.** Claude Cowork (desktop agent) is currently
   excluded from Anthropic's audit logs and Compliance API; customers running it
   will have an unavoidable "absent" class no matter what we build. Worth tracking
   for the E3 mapping.

## 7. Market survey (verified July 2026)

### MCP gateways and proxies

| Product | Shape | Notes |
|---|---|---|
| MintMCP | Managed SaaS | SOC 2 Type II; virtual MCP bundles, hosted connectors; logs MCP method/session metadata |
| Lasso Security MCP Gateway | OSS + commercial | Security-first: prompt-injection detection, PII masking (Presidio), reputation scoring |
| IBM ContextForge | Open source | Registry + proxy, REST-to-MCP conversion, federation, built-in OTel |
| Obot | Open source | Kubernetes-native gateway + catalog + orchestration, IdP attribution |
| Cloudflare AI Gateway + MCP portals | Managed SaaS | LLM and MCP traffic control plane; unified REST API launched May 2026 |
| Kong AI Gateway | Commercial | MCP support on the Kong API platform; best fit for existing Kong shops |
| TrueFoundry MCP Gateway | Commercial | Performance-focused (3 to 4 ms overhead), unified LLM + MCP governance |
| Portkey | Acquired | Palo Alto Networks closed the acquisition 2026-05-29; folding into Prisma AIRS; gateway open-sourced March 2026, now maintenance mode |

Read on the market: active consolidation toward security vendors, and every credible
entrant is either a hyperscaler, a security company, or infrastructure OSS. None
offer business-readable records or work context.

### Agent/LLM observability platforms

Langfuse (acquired by ClickHouse January 2026; still MIT-licensed and
self-hostable), LangSmith, Braintrust, Arize Phoenix, W&B Weave, Datadog LLM
Observability. All are SDK-instrumentation products for engineering teams: deep
reasoning traces, evals, drift detection. None are systems of record (no
tamper-evidence, no work-item context, developer-facing UX). They are complements,
and several are also OTel sources that could feed F3.

### Anthropic-native telemetry

- Claude Code and the Agent SDK export OpenTelemetry natively: tool spans, token
  and cost metrics, structured events; prompts and tool details redacted by
  default with explicit opt-in env vars; tracing is beta behind a flag.
- Claude Enterprise/Teams provide audit logs and a Compliance API (SIEM streaming);
  Claude Cowork is excluded from both (see open question 6).

### Patterns consensus

Practitioner guidance for cross-vendor fleets converges on: SDK or self-reported
depth where you own the agent, OTel collection as the vendor-neutral spine, and an
in-path gateway only where regulated data requires inline inspection or blocking.
That is the shape of the recommendation in section 4.

### Sources

- MintMCP, gateway landscape: https://www.mintmcp.com/blog/gateways-enterprise-engineering-with-mcp
- Strac, MCP gateway buyer's guide: https://www.strac.io/blog/mcp-gateway
- IBM ContextForge: https://ibm.github.io/mcp-context-forge/latest/
- Palo Alto Networks / Portkey acquisition: https://www.paloaltonetworks.com/company/press/2026/palo-alto-networks-completes-acquisition-of-portkey-to-secure-ai-agents
- Cloudflare MCP portals: https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/
- Langfuse joins ClickHouse: https://langfuse.com/blog/joining-clickhouse
- Braintrust observability buyer's guide: https://www.braintrust.dev/articles/best-ai-observability-tools-2026
- Claude Code / Agent SDK OpenTelemetry: https://code.claude.com/docs/en/agent-sdk/observability
- Claude Compliance API coverage and gaps: https://generalanalysis.com/guides/claude-compliance-api
- OTel GenAI semantic conventions (spans): https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
- OTel GenAI MCP conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
- AWS Bedrock AgentCore observability: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability.html
- MLflow, AI gateway architecture guide: https://mlflow.org/articles/ai-gateway-architecture-a-guide-for-technical-teams/
