# Exploration: system and automation integration, and end-to-end execution visibility

Status: exploration (not a commitment). Written 2026-07-19 from a verified deep-research
pass (3-vote adversarial verification per claim where budget allowed; sources cited
inline). Companion docs: `docs/process-intelligence-observability-exploration.md`,
`docs/smartobject-data-layer-exploration.md`, and the assessment reference
`docs/agent-fleet-visibility-options.md`. Builds on the `agent-tracking` release in
Specboard, especially the Agent registry + access transparency epic and the OTLP
activity ingest epic.

**Verification caveat, stated up front.** The research harness verified 25 of 131
extracted claims (budget-limited), and concentrated the verification budget on the
platform-capability questions (UiPath, Power Automate, iPaaS). Those findings are
3-0 or 2-1 verified and are marked so below. The competitive-landscape claims
(section 5) were extracted from primary and secondary sources but were **not** run
through 3-vote verification in this pass; they are marked "unverified" and must be
confirmed before any of them shapes copy or strategy. Two claims were refuted; see
the appendix.

## Why this exploration exists

The self-hosted test customers who framed Palouse as a Process Intelligence audit
layer want more than agent visibility. They want to see the **end-to-end execution**
of their agents and the systems and automations those agents call into, and to read
it without being engineers. Concretely: connect their existing automation platforms
(UiPath, Microsoft Power Automate, and the long tail), observe what those automations
did and which systems they touched, and stitch that together with agent activity into
one legible picture. This doc answers three questions:

1. What execution data can an external, sit-beside observer actually pull from these
   platforms, and what is structurally out of reach?
2. Can end-to-end execution be reconstructed across vendors at all, and by what
   mechanism?
3. Where does the "system registry" concept (from the SmartObject exploration) fit,
   and what should we build first?

The decided architecture stance is unchanged: Palouse observes from **beside** the
request path (telemetry ingest, self-report, vendor audit-log ingest), never as an
in-path gateway (`docs/agent-fleet-visibility-options.md` §4). Everything below is
judged against that stance and against the north star: a business-readable
understanding-and-audit layer, not a network-trace waterfall.

## 1. What is cheaply gettable vs structurally absent, per platform

This is the empirical core. The short version: external observation can reconstruct a
useful, business-readable picture, but fidelity is wildly uneven across platforms and
**tamper-evidence is uniformly absent at every source**. That last point is not a
weakness in our plan; it is the whole reason the sit-beside chain-on-receipt posture
has value.

### UiPath (best case in 2026)

- **Agent/LLM layer is a clean OTLP push.** UiPath Automation Cloud's AI Trust Layer
  can export AI agent execution traces to any external OTLP-compatible endpoint, in
  near real time, via a publicly accessible endpoint authenticated with an API key or
  custom headers (Preview). The exported spans carry trace and span identifiers,
  timestamps, execution status, prompts and completions, token usage, tool calls,
  guardrail evaluations, and UiPath metadata under `attributes.uipath.*`. (Both
  verified 3-0.) This is almost exactly our F3 lane: "set the OTEL endpoint to
  Palouse" is the whole integration.
  ([UiPath OTel config](https://docs.uipath.com/automation-cloud/automation-cloud/latest/admin-guide/configuring-opentelemetry))
- **Maestro is the orchestration story.** UiPath Maestro (2025.10) orchestrates AI
  agents from third-party platforms (Google Vertex, Microsoft Copilot, Databricks,
  NVIDIA, Snowflake, Salesforce) alongside UiPath robots, and markets a unified view
  of what each agent is doing, in which process, at what stage (verified 3-0). This is
  a competitor's in-platform version of the end-to-end view; notably the 2025.10
  launch article frames it in business language and makes **no** mention of
  OpenTelemetry (verified 2-1), so the OTLP export above is a separate, quieter
  capability.
  ([UiPath 2025.10](https://www.uipath.com/blog/product-and-updates/orchestrating-the-agentic-enterprise-whats-new-in-uipath-2025-10))
- **RPA job/queue execution is thinner.** Orchestrator 2025.10 exposes audit events
  through a REST API (a list endpoint and a download endpoint), verified 3-0, but the
  audit-logs API documentation contains **no** mention of immutability, tamper-evidence,
  integrity guarantees, digital signatures, hash-chaining, or OpenTelemetry (verified
  3-0). So classic RPA execution is pullable as plain audit data, without integrity
  guarantees and without OTel.
  ([Orchestrator audit-logs API](https://docs.uipath.com/orchestrator/standalone/2025.10/api-guide/audit-logs))
- **Do not be fooled by "API Audit."** Orchestrator's *API Audit* feature is a
  rate-limit / call-volume monitoring dashboard (calls to `GetAll` on Jobs and
  QueueItems against the 100 req/min/tenant limit), not an execution-data export. A
  claim that it yields programmatic execution reports was refuted 0-3 (see appendix).

Net: UiPath is the platform where we can get the richest, most stitchable data with
the least work, but only for the agent layer, and only in Preview.

### Microsoft Power Automate / Power Platform (hard case)

There is no OpenTelemetry anywhere in Power Automate. Getting real execution telemetry
externally means assembling it from three or four partial surfaces, none complete,
none tamper-evident:

- **Azure Application Insights is the only per-action path.** A managed environment can
  emit cloud-flow run, trigger, and action-level telemetry to the customer's Azure
  Application Insights: runs land in the `requests` table, triggers and actions land
  in the `dependencies` table (verified 3-0). But this telemetry is lossy and not
  tamper-evident (verified 3-0), it is configured at the environment level (verified
  3-0), the enabling announcement does not mention OpenTelemetry (verified 3-0), and
  it only exists if the customer owns and grants an App Insights resource.
  ([App Insights for cloud flows](https://learn.microsoft.com/en-us/power-platform/admin/app-insights-cloud-flow))
- **The FlowRun Dataverse table gives run-level metadata only.** Queryable via the
  Dataverse Web API (OData): start/end time, duration, status, trigger type, error
  code, error message, owner, workflow name (verified 3-0). It is explicitly **not**
  lossless and **not** tamper-evident (verified 3-0), and it captures run-level, not
  action-level, detail (verified 2-1).
  ([FlowRun table](https://learn.microsoft.com/en-us/power-automate/dataverse/cloud-flow-run-metadata))
- **Purview audit logs do not cover runs at all.** They capture only flow lifecycle
  events (create, edit, delete) and permission changes, and explicitly exclude
  individual flow runs, action executions, and connector calls (verified 3-0). So the
  "compliance log" surface is the wrong shape for execution visibility.
  ([Power Automate activity logging](https://learn.microsoft.com/en-us/power-platform/admin/activity-logging-auditing/activity-logs-power-automate))
- **Admin-center analytics are aggregate.** Run counts, usage, errors, by day/week/month,
  refreshed roughly every 24 hours; not per-run trace detail (verified 3-0). But the
  Connectors report does expose which connectors each flow/environment uses (verified
  3-0), which is directly useful for the system registry: it is a ready-made
  automation-to-system edge list.
  ([Flow analytics](https://learn.microsoft.com/en-us/power-platform/admin/analytics-flow))

Net: Power Automate is gettable but fragmented, lossy, and never tamper-evident. For
M365-heavy customers this is high-demand and should sequence alongside or after the F6
vendor audit-log ingest work, since both are Microsoft-tenant credential/consent flows.

### The iPaaS long tail (splits sharply)

- **n8n is the standout and the only cleanly stitchable one.** Native, first-party
  OpenTelemetry: it emits one `workflow.execute` span per run and nested `node.execute`
  spans per node, over OTLP HTTP (protobuf) (verified 3-0). Crucially, its OTel tracing
  supports W3C trace context and **accepts an inbound `traceparent` header on webhook
  triggers, using it as the parent span** (verified 3-0). That inbound-context behavior
  is the one mechanism in this whole survey that lets an automation be woven into a
  larger end-to-end trace rather than merely correlated after the fact.
  ([n8n OTel](https://docs.n8n.io/hosting/logging-monitoring/opentelemetry/))
- **Workato and Tray offer log streaming, not traces.** Workato's Logging Service
  streams to Amazon S3, Azure Monitor, Azure Blob, Datadog, Splunk, Sumo Logic, GCS,
  and similar (extracted, not verified). Tray.ai log streaming pushes Execution Events
  (run status), Step Events (per-step status with input/output), and Audit Events
  (config changes) to external systems (extracted, not verified). These are ingestible
  as event streams into our reported-activity storage, but they are not OTel and carry
  no trace context.
  ([Workato logging](https://docs.workato.com/features/logging-service.html),
  [Tray log streaming](https://docs.tray.ai/platform/enterprise-core/logs-debugging/log-streaming))
- **Zapier and Make** produced no confirmed external execution-log API in this pass.
  Treat as unknown pending a targeted check; the `record_activity` / webhook self-report
  lane (F4) is the fallback for anything without a real execution API.

## 2. Can you actually reconstruct end-to-end execution? The correlation problem

This is the structural finding that should shape expectations. True end-to-end
execution reconstruction (agent tool call → downstream automation run → system of
record it touched, as one linked chain) requires a shared correlation identifier to
propagate across every vendor boundary. The standards to do this exist; the
propagation almost never happens.

- **The vocabulary exists.** OpenTelemetry GenAI semantic conventions define agent span
  operation types (`create_agent`, `invoke_agent`, `invoke_workflow`, `execute_tool`),
  giving a vendor-neutral way to represent agent reasoning and tool invocations
  (extracted, not verified in this pass, but consistent with the 3-0-verified UiPath
  export shape and with prior research).
  ([OTel GenAI](https://opentelemetry.io/blog/2026/genai-observability/))
- **The mechanism exists but is rarely honored across vendors.** W3C trace context
  (`traceparent`) is how a trace stays connected across process boundaries. In this
  survey, n8n is the only platform confirmed to accept it inbound. UiPath's export
  emits its own trace/span IDs (not a parent handed in from an upstream agent), Power
  Automate has no OTel at all, and MCP tool calls do not generally carry a shared
  correlation ID across the hop into a third-party automation. So a single distributed
  trace spanning agent → UiPath → SAP is **structurally absent** today for most of the
  stack.
- **Therefore reconstruction is correlation-by-heuristic, not one trace.** The realistic
  end-to-end picture is assembled from timestamps, entity/resource references (a
  SharePoint URL, a queue item ID, a record key), and our own F1 correlation fields
  (`requestId`, `traceId`, `onBehalfOfUserId`), not from a clean parent-child span tree.
  This is fine, and it is honest, as long as we render confidence and provenance
  clearly and never present a heuristic join as an observed trace.
- **Two models for representing multi-system execution without a single case ID:**
  - **OCEL 2.0** (object-centric event logs): one event can reference any number of
    objects of different types, so a process that spans multiple systems is
    representable without flattening to one case (extracted, not verified; consistent
    with the prior OCEL research). This is the process/audit-view export, already
    captured as an epic.
    ([OCEL 2.0](https://www.ocel-standard.org/2.0/ocel20_specification.pdf))
  - **OpenLineage** (Job / Run / Dataset): a lineage graph woven from observations of
    many jobs across platforms (extracted, not verified). This is the data/system-lineage
    view, and it is the closest existing standard to the "how does data route between
    systems" question the K2 prospect actually asked.
    ([OpenLineage object model](https://openlineage.io/docs/spec/object-model/))

The practical consequence: the join key of last resort is the **system registry**. When
trace context does not propagate, the thing that lets you say "this agent action and
that UiPath job both touched the same customer record in the same system" is a governed
map of systems, objects, and who touches them. That is why the registry is not a
side-feature; it is the backbone that makes fragmented telemetry legible.

## 3. The system registry (where SmartObject Option A lands)

The SmartObject exploration recommended adopting the vocabulary, not the runtime:
a governed business-object / system registry plus a lineage/access view over the audit
spine (`docs/smartobject-data-layer-exploration.md` §4, Option A). This research
sharpens why that is the right shape and what it should contain.

Proposed content of the registry (read-only, governed, grounded in observed activity):

- **Systems**: the systems of record and services in the customer's estate (SAP, NetSuite,
  Salesforce, SharePoint, internal APIs), seeded from the connector registry and from
  automation metadata (e.g. Power Automate's Connectors report, verified 3-0, is a
  ready-made edge list).
- **Business objects**: the logical entities that matter (Employee, Invoice, Order,
  Case), mapped to the systems that hold them. Adopt SmartObject vocabulary, not its
  federation runtime.
- **Actors**: agents and automations (UiPath processes, Power Automate flows, n8n
  workflows) that read or write those objects, with the credential/service identity
  used and the on-behalf-of subject where known (F1 `onBehalfOfUserId`).
- **Edges**: which actor touched which object in which system, via which identity, when,
  and observed vs reported vs self-reported provenance.

The business-readable surface is a **routing/lineage map with drill-down**, not a span
waterfall. The roadmap already asserts that business users do not want trace-waterfall
data (`docs/agent-fleet-visibility-options.md` §3). The registry map answers "how does
data route into our automations and agents, and who touched it as what identity" in a
picture a non-engineer can read, then lets them drill into the underlying (honestly
labeled) events. This is also the natural home for the access-transparency work (C2)
and directly serves the unmet need the SmartObject research identified: K2 SmartObjects
never delivered per-identity runtime access accountability, so "who accessed what, as
which identity, on whose behalf" is genuinely open.

Build posture: extend the existing **Agent registry + access transparency** epic rather
than start fresh, then graduate the system/business-object dimension into its own epic
under a new initiative once the shape is proven.

## 4. What this means for "user-friendly end-to-end"

The customer asked for a user-friendly end-to-end execution view. The honest version we
can deliver, and should scope, has three layers:

1. **The map** (registry): systems, objects, agents, automations, and the edges between
   them. Always available, business-readable, the default surface.
2. **The timeline** (correlated execution): for a given object, case, or time window,
   the ordered set of agent actions and automation runs that touched it, assembled by
   heuristic correlation, each labeled observed / reported / self-reported and with a
   source badge. Where trace context did propagate (n8n today, more later), show the
   real linkage; where it did not, show a correlated-not-traced marker.
3. **The evidence** (audit spine + exports): the tamper-evident chain-on-receipt record
   and the auditor/OCEL exports underneath, which is the thing none of the source
   platforms provide.

That is a defensible, differentiated "end-to-end" that does not overclaim a distributed
trace we cannot actually get.

## 5. Competitive landscape and whitespace (UNVERIFIED, verify before use)

Every claim in this section was extracted from a source but not run through 3-vote
verification. Treat as leads, not facts. Several partially challenge the prior
"nobody ships tamper-evident verifiable audit trails" finding and are therefore
high-priority to verify.

- **UiPath Maestro** (verified 3-0, from §1): the strongest in-platform end-to-end
  view, but it observes from inside its own orchestration control plane, and its
  public framing carries no tamper-evidence claim.
- **Celonis** is converging from process mining: an Object-Centric Data Model marketed
  as a single source of truth for process intelligence, plus a partnership with
  Microsoft Agent 365 for agent oversight (extracted, not verified). Ecosystem-scoped
  and analytics-shaped, consistent with the prior research.
- **Apparent direct tamper-evident-audit competitors** (all extracted, not verified,
  and important to verify):
  - **Agent Audit**: markets hash-chained, tamper-evident AI-agent audit logs with
    optional RFC 3161 notarisation and independent auditor verification with no vendor
    contact required. If real and shipping, this is the closest overlap yet with our
    headline differentiator.
    ([agentaudit.co.uk](https://www.agentaudit.co.uk/solutions/eu-ai-act/))
  - **halo-record**: open-source (Apache-2.0) Python package for SHA-256 hash-chained,
    append-only, independently verifiable agent runtime records ("the audit trail the
    vendor runs but cannot edit"). An open-source analog of our chain.
    ([halo-record](https://github.com/bkuan001/halo-record))
  - **TierZero**: a proprietary "Intent-to-Execution Evidence Chain" cryptographically
    linking intent, context evaluation, policy decision, execution boundaries, and
    outcome per agent mutation. Decision-context-centric rather than cross-vendor
    telemetry stitching.
  - **Arthur AI**: an Agent Discovery & Governance platform with OTel-native end-to-end
    tracing across frameworks and an agent registry with agent cards. A registry
    competitor, developer-facing.
- **The whitespace still holds, narrowly.** None of the above was confirmed doing the
  specific combination Palouse is aimed at: a **neutral, sit-beside, cross-vendor**
  layer that reconstructs agent + automation + system execution in a **business-readable**
  way, on top of a **tamper-evident, independently verifiable** record with
  **auditor-grade regulatory exports**. The convergence (UiPath, Celonis, Microsoft) is
  all in-platform or in-ecosystem; the tamper-evident startups (Agent Audit, halo-record,
  TierZero) are agent-audit-only, not cross-vendor execution reconstruction. But the
  tamper-evident-audit space is now demonstrably contested, so the differentiator must
  lean on the *combination* (neutral + cross-vendor + business-readable + verifiable +
  auditor exports), not on tamper-evidence alone.

## 6. Recommendation

1. **Reuse the three decided lanes; build nothing platform-specific first.** OTLP
   activity ingest (F3) already receives UiPath's agent traces and n8n's workflow spans
   with zero bespoke code. Self-report / webhook (F4) covers the long tail. This is the
   cheapest possible on-ramp and validates demand before per-vendor investment.
2. **Sequence vendor connectors by cost-to-value:**
   - **UiPath first** (OTLP push, richest and cheapest; Preview, so track GA).
   - **n8n next** (native OTel + inbound `traceparent`; the only stitchable one, so it
     is where end-to-end trace linkage can actually be demonstrated).
   - **Power Automate via Application Insights** (high demand for M365 shops, but
     fragmented and lossy; sequence with/after the F6 Microsoft-tenant work since both
     are Entra credential/consent flows).
   - **Workato / Tray log-stream ingest** later, as reported-activity sources.
3. **Build the System registry as the correlation backbone and the business-readable
   surface.** Extend the Agent registry epic first (systems + objects + edges + provenance),
   then graduate it into its own epic. This is what makes non-stitchable telemetry legible
   and is the direct answer to both the "end-to-end, user-friendly" ask and the K2
   prospect's data-routing ask.
4. **Adopt OCEL 2.0 for the process/audit export (already an epic) and evaluate
   OpenLineage for the system-lineage representation.** OpenLineage's Job/Run/Dataset
   model is the closest existing standard to "how data routes between systems" and may
   be a better fit than inventing our own lineage schema.
5. **Label relentlessly.** Almost everything ingested here is reported, lossy, and not
   tamper-evident at source. Our value is chaining it on receipt and making it readable
   and exportable. The moment we blur reported with observed, the audit story dies.
6. **Do not build federation or an in-path gateway.** The correlation problem tempts a
   "just route everything through us" answer; that is SmartObject Option C, already
   rejected, and the gateway decision already made. Sit beside, ingest, correlate,
   attest.

## 7. Proposed backlog shape (for discussion, not yet created)

A new initiative alongside Agent Tracking, roughly:

- **Initiative: System & Automation Integration.**
  - **Epic: System / business-object registry** (graduated from the Agent registry
    epic): systems, objects, actor-to-object edges, provenance, the routing/lineage map
    UI. Size L.
  - **Epic: UiPath connector** (AI Trust Layer OTLP ingest + Orchestrator audit-log
    pull; render as reported activity; map into the registry). Size M.
  - **Epic: n8n connector** (OTel ingest + demonstrate inbound `traceparent` stitching
    as the reference end-to-end case). Size S/M.
  - **Epic: Power Automate connector** (App Insights egress ingest + FlowRun/OData +
    Connectors-report edges; coordinate with F6). Size M/L.
  - **Epic: OpenLineage evaluation / lineage representation** (spike, then decide vs a
    native schema). Size S.
  - Workato/Tray/Zapier/Make log-stream + self-report ingest fold into F4 and later
    epics.

## 8. What would validate this (cheap first)

1. Point the OTLP endpoint at a UiPath AI Trust Layer trial export and confirm we
   render agent traces as reported activity end to end, with zero UiPath-specific code.
   This is the cheapest possible proof and de-risks the whole thesis.
2. Stand up an n8n instance, pass a `traceparent` from a Palouse-observed action into an
   n8n webhook, and confirm the spans stitch into one trace. This validates the one real
   end-to-end-linkage path.
3. Ask the automation-owning prospects: which platforms, which systems do those
   automations touch, and what would an auditor ask them about a cross-system run today.
4. **Verify the section 5 competitor claims**, especially Agent Audit and halo-record,
   before the "nobody ships verifiable tamper-evident trails" line is used anywhere. This
   is the highest-priority verification debt from this pass.
5. Prototype an OpenLineage vs OCEL representation of one real cross-system run and see
   which reads better to a non-engineer.

## Appendix: verification status

**Refuted in this pass (do not repeat):**

- "UiPath Orchestrator's API Audit feature lets an external observer export execution
  reports for Jobs and QueueItems, giving programmatic visibility into automation runs"
  (0-3). API Audit is a rate-limit / call-volume monitoring dashboard, not an execution
  data source.
- "The UiPath API Audit documentation shows immutability, export format, and OTel are
  structurally absent" (1-2). Overreach: the page describes an export button, and
  Orchestrator's separate audit-logs API has a defined format; structural absence cannot
  be inferred from one page's silence. (Note the narrower, correctly scoped claim that
  the 2025.10 *audit-logs API docs* mention no immutability or OTel did verify 3-0.)

**Verified 3-0 / 2-1 (safe to rely on):** all UiPath capability claims in §1 except
where marked; all Power Automate surface claims in §1; all n8n claims in §1. See inline
markers.

**Extracted but NOT verified (leads only, verify before use):** everything in §5; the
OCEL 2.0, OpenLineage, and OTel GenAI semconv detail in §2; the Workato and Tray log-
streaming specifics in §1. The verification budget in this pass (25 of 131 claims) was
spent on the platform-capability questions, not the competitive and standards questions.
