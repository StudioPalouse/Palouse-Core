# Exploration: the K2 "SmartObject" concept and a data layer for Palouse

Status: exploration (not a commitment). Written 2026-07-18 from a verified deep-research pass
(3-vote adversarial verification per claim; sources cited inline). Companion doc:
`docs/process-intelligence-observability-exploration.md`.

## Why this exploration exists

A prospect in a governed industry walked us through a use case: they want to see how data
routes from their systems of record into their automations and AI agents, and to control
data access along that path. They use Nintex K2 Five on-premises for data joining and
referenced its "SmartObject" concept as the mental model. This doc answers: what is that
concept actually, what happened to it, and where (if anywhere) could something like it sit
in Palouse long-term.

## 1. What a SmartObject actually is

All claims below verified 3-0 against Nintex/K2 vendor documentation.

- A SmartObject is a **logical business object** (properties + methods) that forms,
  workflows, reports, and custom code use to interact with line-of-business data without
  knowing the underlying systems. It is a middle tier between data providers (SQL,
  SharePoint, AD, REST/OData) and consumers.
  ([terminology](https://help.nintex.com/en-US/k2five/userguide/5.3/Content/ServiceBrokers/SmartObjectTerminology.htm),
  [architecture](https://help.nintex.com/en-us/k2five/devref/current/content/reference/Platform/k25architecture.html))
- It **virtualizes rather than replicates**: no LOB data is copied into K2; source systems
  remain systems of record. The K2 server does not cache SmartObject data, so every call is
  live.
- Connectivity is **broker-based and pluggable**: a Service Broker (a .NET assembly)
  translates between the SmartObject method model and a provider's native protocol; a
  Service Instance is a configured connection (server, URL, auth mode). System brokers
  (SQL, Oracle, AD, SharePoint) coexist with technology brokers (REST, OData) and a custom
  broker SDK. Structurally this is almost 1:1 with Palouse's connector registry
  (`packages/connectors/core/src/adapter.ts`).
- **Composite (advanced) SmartObjects** are the data-joining capability the prospect uses:
  one logical entity (e.g. Employee) whose Read fans out to a SQL method and an AD method,
  matched on a shared key property (e.g. Email), consolidated centrally before returning.
  Verifiers note this is sequential method execution on a hand-configured join key, not a
  query-pushdown federation engine like Denodo.
- The SmartObject server is a **first-class platform server** (alongside Workflow,
  SmartForms, and the authorization framework), and Nintex still markets the concept as
  "reusable business data components" (build once, use everywhere).

### The part the marketing overstates: security

This is the strategically important finding. "Centralized security" at the SmartObject
layer is real but much narrower than commonly assumed:

- Auth to LOB systems is configured at the **service-instance (connection) level**
  (Impersonate, ServiceAccount, SSO, OAuth). That centralizes connection governance, not
  per-user data access.
- The SmartObject Security node governs **design-time rights only** (who may publish or
  delete definitions), and even that was partly deprecated mid-lifecycle. Per K2's own
  authorization docs, "SmartObjects do not expose runtime rights."
- Under ServiceAccount mode (and for workflow-invoked calls), **all users reach the LOB as
  the K2 service account**. Runtime data security is delegated to the backends or gated in
  the form/view layer.
  ([SmartObject Security](https://help.k2.com/onlinehelp/k2five/userguide/5.3/Content/K2-Management-Site/Integration/SmartObjectSecurity.htm))

Implication: the historically loved product in this space never actually delivered
per-role, per-record runtime access control at the virtual layer, and identity frequently
collapses into a service account. "Who actually accessed what, through which service
identity, on behalf of whom" is therefore an **unmet need**, and it is an observability
need, not a data-layer need. That is exactly what Palouse's audit spine plus the planned
correlation fields (`onBehalfOfUserId`) and access-transparency work are shaped for.

## 2. What happened to K2 (trajectory)

Verified 3-0 against Nintex lifecycle documentation:

- Nintex acquired K2 in 2020. There is **no platform-wide end of life and no forced cloud
  migration**. The on-prem line continues as "Nintex Automation K2": 5.9 LTS shipped
  2 Dec 2025, standard support to 31 Dec 2027, extended to 31 Dec 2029, still actively
  developed (5.9.1 adds locally hosted AI actions). Nintex is migrating Nintex for
  SharePoint customers into K2, positioning it as the on-prem path forward.
- But there is a hard cliff for laggards: **K2 Five 5.6 extended support ends 31 Aug 2026**,
  about six weeks from this writing. Standard support already ended Aug 2024.
  ([release strategy](https://help.nintex.com/en-US/platform/K2Support/K2ReleaseStrategy.htm))
- The 2+2 LTS cadence signals maintenance-mode stewardship rather than growth.

Two consequences for us:

1. **No "stranded install base" wedge.** The prospect's K2 investment likely persists for
   years. Palouse should plan to observe alongside K2, not offer an escape path from it.
2. **Near-term conversation opener.** If the prospect is on 5.6 or older, they lose all
   vendor support on 31 Aug 2026 and are presumably mid-upgrade or mid-decision right now.
   Worth asking which version they run.

## 3. Standards substrate

The OpenTelemetry GenAI semantic conventions now explicitly cover MCP (spans, metrics, and
events for GenAI clients and MCP interactions, `mcp.*` attribute namespace, tool-call
context via `gen_ai.tool.name`). An MCP-first product can align agent and data-access
telemetry with a vendor-neutral standard instead of inventing a schema. Caveat: the
conventions are at Development stability, so pin a semconv version.
([semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai))

This dovetails with the already-planned OTLP work (F3 in
`docs/agent-fleet-visibility-options.md`) and the OTLP activity ingest epic on the board.

## 4. Options for where a SmartObject-like concept could sit in Palouse

Ordered from least to most build risk.

### Option A: Business-object registry + lineage/observation layer (recommended)

A read-only, governed catalog of "business objects" mapped from Palouse connectors and
agent activity: which logical entities exist, which systems they live in, which
automations and agents read or write them, via which credentials, on whose behalf. Data
routing becomes a queryable, tamper-evident map rather than a runtime service.

- Reproduces the durable value of SmartObjects (one logical model, reusable across
  consumers) without taking on a runtime.
- Directly serves the prospect's stated need: routing visibility plus access audit.
- Builds on what exists: connector registry, audit spine, entity-targeted events, OTLP
  ingest, and the planned correlation fields and access-transparency epics.
- Risk: low. It is an extension of the current architecture's grain.

### Option B: MCP resource catalog with access policies (plausible second step)

Expose the registry's objects as MCP resources with per-agent, per-scope access policies.
Policy decisions (allow/deny, and why) are logged to the audit spine; enforcement is
delegated to source systems where possible, with Palouse-issued credentials scoped to the
policy where not. This generalizes the existing approval-checkpoints and MCP tool-gating
backlog items.

- Adds a control point without becoming the data path for reads/writes at large.
- Risk: medium. Policy evaluation must be correct and fast; partial in-path exposure for
  MCP-mediated access only.

### Option C: Full virtual data layer (rejected for the long term)

Composite objects, live joins, in-path federation across customer backends.

- This is the genuinely hard part of SmartObjects: an always-live, uncached federation
  runtime with availability and correctness liability. It is core business for
  Denodo-class vendors and orthogonal to an audit platform's trust proposition.
- K2's own history shows the security promise at this layer goes unmet; we would inherit
  the same gap while giving up our "not in the request path" architectural stance
  (already decided against for the MCP gateway in
  `docs/agent-fleet-visibility-options.md`).
- Risk: high, and it competes with our credibility as an independent observer.

## 5. Recommendation

Adopt the SmartObject **vocabulary**, not its runtime: a governed business-object registry
that names the logical entities of the customer's portfolio, mapped to systems, and a
lineage/access view over the audit spine that shows how data routes into automations and
agents and who touched it as what identity. Treat Option B as a candidate follow-on once
the registry exists. Keep full data virtualization out of scope permanently unless strong
new evidence emerges.

Honest gap in the evidence: the modern-equivalents landscape (Denodo, Dremio, Cube, MCP
gateways with policy enforcement, Immuta, Fabric/Dataverse virtual tables) produced no
surviving verified claims in this research pass, so the competitive-whitespace argument
for Options A/B rests partly on absence of evidence. Before committing roadmap, do a
focused competitive check on MCP gateway products and agent data-access governance tools,
and validate Option A's framing with the prospect (ask: their K2 version, which systems
feed their agents, and what an auditor would ask them today).

One refuted claim worth remembering: "SmartObjects never store data" is not strictly true
(SmartBox-backed simple SmartObjects store data in K2's own database), so when talking to
K2 shops, distinguish SmartBox objects from LOB-backed ones.
