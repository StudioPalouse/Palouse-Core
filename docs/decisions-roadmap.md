# Decisions capability: market landscape and enhancement roadmap

Status: proposal (2026-07-11). Research inputs: deep market research (verified against
vendor docs, June/July 2026) plus a full map of the existing decisions implementation.

Customer feedback: users, especially remote distributed teams, want AI to help identify
and track business decisions. Five goals drive this roadmap:

1. Capture decisions as they are being made (Microsoft 365 / Copilot and similar).
2. Track decision ownership and stakeholder input.
3. Help with change management and enablement after cross-team decisions.
4. Enable reporting around decisions.
5. Deepen the relationship of decisions to projects and objectives.

## 1. Market landscape (verified findings)

### Meeting AI tools do not ship structured decisions

Surveyed Otter, Read AI, Fellow, Zoom AI Companion, and Teams Copilot (July 2026):
action items are first-class objects industry-wide (IDs, owners, endpoints, webhooks,
routing). Decisions are not, anywhere.

| Tool | Decisions in summary | Decisions as API object | Decision routing |
|---|---|---|---|
| Otter.ai | Prose only | No | No |
| Read AI | Prose only | No (`action_items`, `key_questions`) | No |
| Fellow | Yes, labeled recap section | No (Notes/Recordings/Action Items only) | No |
| Zoom AI Companion | No (next steps only) | No | No |
| Teams Copilot AI Insights | No (notes + action items) | No | No |

Microsoft's own Meeting AI Insights docs tell integrators to run their own NLP to
classify insights "such as decisions, tasks, or risk items" before pushing to external
systems. Microsoft is explicitly delegating decision extraction to third parties.
Watch item: Fellow's API is expanding fastest and its marketing already promises
decision flow-through.

### Decision-to-strategy linkage is rare

- Atlassian Home (ex-Atlas) is the only major vendor with a first-class decision
  entity, but it is scoped to a project (Decisions tab), reaches goals only indirectly
  through project updates, has no cross-project decision register, and is
  under-documented.
- Notion/Coda: DIY database templates with generic relations; no lifecycle, RACI, or
  semantics. Productboard: decisions are implicit in prioritization scores. WorkBoard
  (merged with Quantive, May 2025): decisions are meeting takeaways, not entities.
- No verified product offers a direct, queryable decision-to-OKR/key-result edge.
  Palouse's `decision_relations` + objectives model is already ahead here; the enum
  even reserves the `goal` entity type. It just is not wired up.

### Post-decision change management is unoccupied ground

Three mature ingredient categories exist and no product combines them:

1. Structured decision records (ADR tools, Cloverpop, Palouse).
2. Targeted announce + per-person acknowledgement + auto-remind + export
   (Simpplr Must Read, Staffbase, Guru announcements, PowerDMS/NAVEX policy
   attestation, Slack ack bots).
3. Segment-targeted in-app delivery with completion analytics (WalkMe, Whatfix, Pendo).

The only record-driven acknowledgement loop found is ServiceNow GRC policy campaigns
(policy record generates per-person acknowledgement records), and it is confined to
compliance policies. ADR tooling does nothing on supersession beyond a status string.
Nobody auto-escalates non-acknowledgers. A decision record that drives a targeted
acknowledgement campaign with rollup on the decision itself has no competitor as of
mid-2026.

### Stakeholder input and decision quality patterns worth borrowing

- Loomio: stance voting (Agree/Abstain/Disagree/Block) with per-voter reasoning,
  many poll types, and governance encoded as reusable decision templates
  (advice/consent/consensus/majority).
- Cloverpop Decision Bank: capture rationale, data sources, and expected outcome at
  decision time, then review outcomes later to measure decision quality. Cloverpop
  notifies stakeholders when decisions are recorded but has no per-person read receipt.

### Microsoft 365 integration surface (the load-bearing facts)

- Graph meeting transcripts are post-meeting only: subscribe to change notifications,
  fetch `.vtt` (recording as `.mp4`). Real-time capture requires a media bot; not worth
  it for slice 1.
- Two permission paths: tenant-wide application permissions (admin consent), or
  resource-specific consent (RSC) permissions such as `OnlineMeetingTranscript.Read.Chat`
  grantable by the meeting organizer/team owner themselves. RSC enables bottom-up,
  per-meeting adoption without an IT approval cycle. Caveats: admins can restrict RSC;
  not available for ad hoc calls.
- Speaker attribution in Graph transcripts is off by default (Teams admin center
  toggle). Without it we cannot attribute statements to a decider. Tenant transcript
  Graph-access controls are being enforced from 2026-07-29; our setup docs must cover
  both toggles.
- Meeting AI Insights API (Graph v1.0) returns structured `meetingNotes`, `actionItems`,
  and mentions, but only on behalf of a Copilot-licensed user (delegated) and not for
  channel meetings. Good premium path; cannot be the only path.
- Copilot extensibility: declarative agents can consume a remote MCP server directly
  (GA December 2025, plugin manifest v2.4 `RemoteMCPServer`). We can reuse
  `mcp.palouse.ai` instead of building an OpenAPI plugin. Constraints: static OAuth
  client only (no dynamic client registration; register in Teams developer portal,
  redirect URI `https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect`, auth-code
  flow, no 307 from the token endpoint). Copilot Studio separately supports full DCR
  ("Dynamic discovery"), which our oauth-provider setup matches nearly drop-in.
- Licensing: declarative agents are covered for Copilot-licensed users at no extra
  charge; Copilot Chat-only users trigger metered Copilot Credits when the agent
  touches tenant data. A claim that Graph transcript APIs are metered pay-per-use was
  refuted in verification; do not assume that cost without checking current terms.
- Distribution: Partner Center to the Agent Store for GA; per-tenant custom app upload
  for pilots.

## 2. Positioning

Palouse becomes the system of record for decisions. Meeting tools and Copilot produce
decision exhaust; nobody structures or routes it. We already have the hard part
(lifecycle, RACI with single-Accountable enforcement, relations, audit trail, agent
API). The roadmap closes the loop: capture, deliberate, decide, roll out, measure,
ladder to strategy.

## 3. Enhancement themes

### Theme A: Capture (goal 1)

- **A1. Decision inbox.** Agent-proposed decisions land as `proposed` with `origin:
  agent` (already supported) plus new source provenance: a `decision_sources` table
  (source system, external ref, meeting title/time, excerpt, confidence). Review queue
  UI: accept, merge into an existing decision, or dismiss. This is the shared landing
  zone for everything below.
- **A2. Copilot declarative agent on the existing MCP server.** Manifest v2.4
  `RemoteMCPServer` pointing at `mcp.palouse.ai`; mint one static OAuth client in our
  oauth-provider for the Teams developer portal registration. Users log and query
  decisions from Copilot/Teams chat. Cheapest M365 entry point since the MCP server
  and OAuth provider already exist.
- **A3. Teams meeting capture connector.** New `ms_meetings` connector on the
  `microsoft-graph` base (same Entra app family): Graph change notification on
  transcript creation, fetch `.vtt`, run extraction, emit proposed decisions into the
  inbox. Offer RSC per-meeting consent as the low-friction path alongside tenant-wide
  admin consent (admin consent URL pattern already exists in the graph connector).
  Fits the existing adapter + BullMQ + `webhookDeliveries` infrastructure.
- **A4. Generic capture ingest.** Inbound webhook endpoint + Zapier-friendly API that
  accepts meeting summaries/transcripts from Fireflies (`meeting.summarized`), Read AI,
  Fellow, etc., through the same extraction pipeline. Positions Palouse as the decision
  router none of those tools ship.
- **A5. Meeting AI Insights premium path.** For Copilot-licensed tenants, classify the
  pre-structured notes/action items into decisions instead of parsing raw VTT.

### Theme B: Ownership and stakeholder input (goal 2)

- **B1. Input rounds.** The Loomio pattern on top of RACI: request stances from
  Consulted/Informed stakeholders (agree / concerns / block / abstain) with a rationale
  and a deadline. New `decision_input_rounds` + `decision_inputs` tables; surface
  stance counts and unanswered requests on the decision.
- **B2. Accountable sign-off.** Explicit approval step to move `under_review` to
  `accepted`/`rejected` (single-Accountable rule already enforced in the service).
  Reuse the handoff state machine pattern.
- **B3. Decision process templates.** Per-workspace templates encoding governance
  (advice, consent, consensus, DACI) that pre-fill stakeholder roles, input rounds,
  and required fields.
- **B4. Stakeholder notifications.** Queue jobs + Resend emails: "you are now
  Accountable," "your input is requested," "decision finalized." Foundation for
  Theme C.

### Theme C: Change management and enablement (goal 3, the differentiator)

- **C1. Rollout campaigns on the decision record.** When a decision is accepted,
  optionally launch a rollout: choose audience (workspace members now; teams when we
  have them), send announcement (in-app + email), create per-person
  `decision_acknowledgements`, auto-remind on a schedule (market norm: Guru 3-day,
  Simpplr weekly), and roll up reach on the decision detail. Tables:
  `decision_rollouts`, `decision_acknowledgements`.
- **C2. Escalation.** After N reminders, surface non-acknowledgers to the Accountable
  owner. No product in the market does this.
- **C3. Supersession propagation.** When a decision is superseded or deprecated,
  notify everyone who acknowledged the original plus stakeholders of related
  projects/objectives. ADR tools treat supersession as a passive status string; we
  make it an event.
- **C4. Enablement tasks.** Spawn follow-through tasks from a rollout (per-team
  adoption steps), linked via `decision_relations` so completion is visible from the
  decision.

### Theme D: Reporting and analytics (goal 4)

- **D1. Decision dashboard.** Counts by status/area, time-to-decision (proposed to
  decided; `decided_at` already stamped), aging decisions stuck in review,
  stakeholder participation. Existing recharts + dashboard card infrastructure.
- **D2. Outcome review.** The Cloverpop pattern: capture expected outcome and a review
  date at decision time; housekeeping job prompts the Accountable at review time to
  record the outcome (worked / mixed / did not work). This is the seed of decision
  quality metrics and a strong retention hook.
- **D3. Decision register export.** CSV/report of decisions by area/quarter with
  stakeholders and outcomes; audit trail already exists for compliance-grade history.
- **D4. Rollout reach reporting.** Acknowledgement rates per decision and per team
  (from Theme C).

### Theme E: Strategy linkage (goal 5)

- **E1. Wire decisions to objectives.** The `goal` entity type is reserved in
  `decision_entity_type` but unmapped. Add objective (and key result) pickers to the
  relations UI, which today only implements tasks.
- **E2. Reverse lookups.** "Decisions" sections on project and objective detail pages
  (which decisions affect this project / support this goal).
- **E3. Strategy signals.** Dashboard surfacing: open decisions blocking at-risk key
  results, projects with unresolved proposed decisions.

## 4. Suggested sequencing (tracer-bullet slices)

Each slice is thin end-to-end, shippable, and pausable for feedback.

1. **Strategy linkage** (E1, E2): pure internal wiring, no migration risk beyond a
   relations mapping, unlocks reporting stories. Fastest visible win.
2. **Decision inbox + generic ingest + MCP provenance** (A1, A4): establishes the
   capture landing zone; agents via MCP can already create decisions today, so this is
   mostly provenance + review UX.
3. **Copilot declarative agent** (A2): reuses `mcp.palouse.ai`; effort is OAuth client
   registration + manifest + packaging + pilot via custom app upload.
4. **Stakeholder input rounds + sign-off + notifications** (B1, B2, B4): builds the
   notification rails Theme C needs.
5. **Rollout + acknowledgements** (C1, C2): the market differentiator; depends on
   slice 4 rails.
6. **Teams meeting capture connector** (A3): highest external-surface risk (tenant
   toggles, consent models); do it once the inbox has proven the review UX.
7. **Outcome review + decision dashboard** (D1, D2): most valuable once volume exists.

Capability gating: ship each theme behind the existing capability toggle pattern
(either new sub-capability keys or a config JSONB on `workspace_capabilities`).

## 5. Constraints and gotchas to carry into design

- Graph transcript capture is post-meeting only; set expectations accordingly ("logged
  minutes after the meeting ends," not live).
- Speaker attribution and Graph transcript access are tenant admin toggles (attribution
  off by default; access controls enforced from 2026-07-29). Onboarding docs must
  include both; extraction must degrade gracefully without attribution (decision without
  a decider still lands in the inbox for a human to assign).
- RSC is unavailable for ad hoc calls and admins can restrict who may grant it.
- Meeting AI Insights requires a Copilot license per user and excludes channel
  meetings; treat as premium enhancement, not the base path.
- Declarative agent OAuth: static client only, fixed Teams redirect URI, auth-code
  flow, token endpoint must not 307. Our DCR flow stays for Copilot Studio and other
  MCP clients.
- Copilot Chat-only users incur metered Copilot Credits when an agent touches tenant
  data; call this out in pricing/positioning conversations.
- Refuted claims from research (do not build on these): "Graph transcript APIs are
  metered pay-per-use" and "tenant Graph transcript access is already disabled by
  default everywhere." Verify current Microsoft terms at build time; the docs are
  moving (June/July 2026 updates, plugins-to-actions terminology shift).
