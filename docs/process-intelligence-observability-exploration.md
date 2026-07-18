# Exploration: agent observability as Process Intelligence, and where Palouse fits

Status: exploration (not a commitment). Written 2026-07-18 from a verified deep-research
pass (3-vote adversarial verification per claim; sources cited inline). Companion doc:
`docs/smartobject-data-layer-exploration.md`. Prior internal work this builds on:
`docs/agent-visibility-roadmap.md`, `docs/agent-fleet-visibility-options.md`, and the
`agent-tracking` release on Specboard.

## Why this exploration exists

Self-hosted test customers have been far more interested in Palouse's agent observability
than in task integration. Several framed it as the future of Process Intelligence: Palouse
as an observation and audit layer sitting next to or over their automation, orchestration,
and agent tooling, especially attractive in highly governed industries. This doc maps who
else is converging on that space, where the verified gaps are, and whether expanding is
sensible.

## 1. Who is converging on this space (2025-2026, verified)

The convergence is real and recent. Every major finding below survived 3-0 adversarial
verification.

### Process intelligence incumbents

- **SAP Signavio "agent mining"** (announced Nov 2025): applies process intelligence to AI
  agent behavior, positioned as cross-vendor ("a unified lens across an organization's AI
  landscape") and explicitly markets compliance ("Ensure compliance through auditable
  decision trails"). But: native support is limited to Joule Studio 2.0 agents emitting
  OTel traces; third-party coverage is "can extend" positioning, likely pre-GA; and the
  announcement contains zero mention of tamper-evidence, retention, or any named
  regulation.
  ([SAP News](https://news.sap.com/2025/11/how-sap-signavio-agent-mining-transforms-enterprise-ai/))
- **Celonis Agent Miner by Bloomfilter** (Celosphere, Nov 2025): merges traditional system
  event logs with "agentic event logs" into one process view of hybrid human+agent work.
  This is a working bridge between agent traces and classic process mining inside the
  Celonis platform. But: demonstrated scope is heavily SDLC-oriented (agents writing
  code), status looks preview-stage, and there are no tamper-evidence, auditor-export, or
  regulatory-mapping claims.
  ([Celonis press](https://www.celonis.com/news/press/bloomfilter-unveils-agent-miner-app-to-observe-govern-agents))
- **Celonis + Microsoft Agent 365** (announced May 2026, private preview): cross-ecosystem
  agent visibility including inter-vendor "ghost loop" detection. Division of labor:
  Microsoft owns the agent registry/control plane (Agent 365) and first-party audit records
  (Purview); Celonis layers business-impact analytics on top. Neither claims an
  independent or tamper-evident audit layer.
  ([Celonis blog](https://www.celonis.com/blog/scaling-the-agentic-enterprise-with-microsoft-agent-365-and-celonis))

### Orchestration incumbents

- **UiPath Maestro** (2025.10, shipping): orchestrates third-party agents (Google Vertex,
  Microsoft Copilot, Databricks, Snowflake, Salesforce, CrewAI) and claims cross-platform
  observability and auditability. But it observes from inside the orchestration/request
  path, and its audit story is plain logging under UiPath RBAC. Verifiers cross-checked
  the Orchestrator audit-log API: no cryptographic integrity, immutability, or
  verification features anywhere in the platform; export is plain CSV/API.
  ([UiPath blog](https://www.uipath.com/blog/product-and-updates/orchestrating-the-agentic-enterprise-whats-new-in-uipath-2025-10))

### Developer observability

- **Langfuse acquired by ClickHouse** (Jan 2026, alongside ClickHouse's $400M Series D).
  Langfuse claims 19 of the Fortune 50 and 63 of the Fortune 500 (unaudited vendor
  metrics), and Merck self-hosts it specifically to keep pharma data in-house. It remains
  MIT-licensed and self-hostable post-acquisition. Two readings: (a) governed enterprises
  demonstrably accept open-core self-hosted observability, validating our model; (b) the
  developer-facing tracing layer is now incumbent-backed and free, so competing there is
  a dead end.
  ([ClickHouse](https://clickhouse.com/blog/clickhouse-acquires-langfuse-open-source-llm-observability),
  [Langfuse/Merck](https://langfuse.com/users/merckgroup))

## 2. The verified gap

Across every announcement and doc set examined, **nobody was confirmed shipping**:

1. Tamper-evident, hash-chained, independently verifiable audit trails of agent activity.
2. Auditor/regulator-facing evidence exports with compliance mapping to named regulations
   (EU AI Act Art. 12/26, SEC 17a-4, FINRA 4511, HIPAA, DORA).
3. An independent layer that sits beside the orchestration path rather than inside it.
4. A neutral cross-vendor layer not owned by one ecosystem's control plane.

These are absence-of-evidence conclusions as of July 2026 (announcements and public docs),
not proofs, but they held under adversarial verification. Palouse has already shipped
item 1 (v0.21.0 hash-chained `audit_events` with external verification recipe) and has
items 2-4 as designed roadmap.

### The protocol layer leaves the same opening

MCP, A2A, ACP, and ANP all treat audit and integrity as deployment-level concerns, not
protocol features. Academic evaluation (arXiv:2511.03841, arXiv:2505.02279) found A2A
"omits persistent audit logging of sensitive events," with "absence of immutable logs
prevent[ing] reconstruction of delegation histories," and concluded no evaluated protocol
ships the per-message integrity and immutable records regulatory conformance requires.
A2A's JWS signing covers capability cards, not runtime messages. NSA MCP security guidance
(May 2026) and practitioner writing corroborate that MCP audit logging is an external
problem. In other words: the protocols themselves delegate the audit trail to exactly the
kind of layer Palouse is.

### The regulatory hook, stated carefully

EU AI Act Article 12(2) ties high-risk-system logging to deployer-side monitoring duties
under Article 26(5), which is the statutory link between provider logs and business-facing
oversight, i.e. our buyer. **Two stronger framings were refuted in verification** and must
not appear in our copy or pitches: (a) that Article 12 flatly mandates automatic lifetime
logging creating direct demand for a product like ours, and (b) that an Article 12
deadline lands on 2 Aug 2026. The tailwind is real but narrow; demand has to be validated
with buyers, not asserted from statute.

## 3. Standards the layer should speak

- **OTel GenAI semantic conventions** (already planned via F3/OTLP ingest): now explicitly
  cover MCP. Development-stability; pin a semconv version.
- **OCEL 2.0** (object-centric event logs): verified as a viable interop bridge from our
  entity-mutation audit spine into the process mining ecosystem. Unlike case-centric XES,
  OCEL models object change over time and object-to-object relationships, which maps
  naturally onto `audit_events` (actor, action, target entity, before/after). Tooling
  reaches pm4py, ProM, and a provisional (script-based, not first-party) Celonis upload
  path. An OCEL export would let customers mine Palouse's record in Celonis-class tools
  instead of us building process mining. Caveat: one claim that OCEL 2.0 is "the official
  standard" only went 1-2; treat it as the de facto emerging format.
  ([ocel-standard.org](https://www.ocel-standard.org/))
- A refuted claim worth noting: the "enterprises will run MCP+ACP+A2A+ANP simultaneously
  and need cross-protocol visibility" roadmap story went 1-2. Don't lean on
  multi-protocol sprawl as a demand driver; ACP has largely merged into A2A.

## 4. Strongest opportunities for Palouse

Ranked synthesis (medium confidence; each element rests on 3-0 verified claims, the
ranking is judgment):

1. **Tamper-evident, verifiable audit spine as the headline differentiator.** No incumbent
   claims it. We already ship it. Lean into independent verification (external recipe,
   CLI verify) as the thing bundled logs cannot be.
2. **Auditor-grade evidence exports mapped to named regulations.** This is roadmap Theme B3
   + E3. The research strengthens the case for pulling these forward: it is the second
   half of the differentiator, and nobody else is even marketing it concretely.
3. **Sit-beside independence as a trust property.** A platform cannot independently audit
   itself. UiPath/Microsoft/SAP observe from inside their own control planes. Our
   already-decided "not in the request path" stance (`agent-fleet-visibility-options.md`)
   turns out to be the positioning, not just an architecture choice.
4. **OCEL 2.0 export: bridge into process intelligence rather than compete with it.** A
   small, standards-based feature that makes Palouse the audit-grade event source for
   Celonis/Signavio-class mining. This is the concrete "future of Process Intelligence"
   answer for the test customers using that language: they mine wherever they like; the
   evidence layer is ours.
5. **Protocol-gap capture.** Be the external audit layer MCP/A2A explicitly delegate to;
   track the OTel GenAI MCP conventions and the IETF/OWASP agent-audit work so our ingest
   speaks whatever lands.

## 5. Risks and counterarguments

- **"The platforms will bundle this."** They already bundle logging and already claim the
  governance vocabulary (Signavio: "auditable decision trails"). The verified counter: all
  of their audit stories are first-party, mutable, and ecosystem-scoped. Bundling cannot
  produce independence or third-party verifiability by definition. The residual risk is
  real, though: Agent 365 and Signavio agent mining are pre-GA; their capabilities could
  harden. Reassess when they GA.
- **Regulatory demand overstated.** The two refuted claims above show how easy it is to
  oversell the EU AI Act angle. Buyer validation is mandatory before investment.
- **Big-company gravity.** Microsoft is positioning Agent 365 as *the* agent registry.
  Our agent registry (Theme C1) should interoperate (ingest/reference), not fight for
  registry-of-record status in Microsoft-first shops. The F6 vendor audit-log ingest work
  is the right posture.
- **We are small and the space is loud.** The wedge must stay narrow: governed industries,
  audit-heavy, self-hosted-friendly. Langfuse/Merck proves that channel exists.

## 6. What would validate demand (next steps, cheap first)

1. Structured interviews with the test customers who used the "Process Intelligence"
   framing: what would an auditor or regulator ask them today about agent activity, and
   what evidence would they need to produce? Which named regulation drives them?
2. Ask the Nintex/K2 prospect the data-routing questions in the companion SmartObject doc
   (their K2 version matters: 5.6 support ends 31 Aug 2026).
3. Prototype an OCEL 2.0 export of `audit_events` (small; pm4py round-trip as the test)
   and put it in front of anyone using Celonis or process mining tooling.
4. Pull forward auditor exports (B3) ahead of digests/signals if interviews confirm the
   evidence-production pain.
5. Watch for GA: Signavio agent mining, Celonis Agent Miner scope beyond SDLC, Agent 365
   preview-to-GA. Set a re-check for Q4 2026.

## Appendix: claims refuted in verification (do not repeat)

- "EU AI Act Article 12 mandates automatic lifetime logging, creating direct demand for
  this product" (0-3).
- "Article 12 obligations hit on 2 Aug 2026, an imminent deadline" (0-3).
- "SAP agent mining cross-vendor support is shipped fact" (0-3 as stated; it is
  positioning, possibly pre-GA).
- "OCEL 2.0 is the current official standard" (1-2; emerging de facto format).
- "Enterprises will run four agent protocols simultaneously, needing cross-protocol
  visibility" (1-2).
