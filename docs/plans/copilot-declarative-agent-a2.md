# Scoping: Copilot declarative agent on the existing MCP server (Theme A, A2)

Status: scoping (2026-07-12). Parent: `docs/decisions-roadmap.md` (Theme A, goal 1) and
`docs/plans/decisions-theme-a-capture.md` (§13 slice 3). This is the fastest Microsoft 365
entry point: it reuses `mcp.palouse.ai` and our existing OAuth provider and needs no new
connector, extraction pipeline, or LLM dependency.

**One-line goal:** ship a Microsoft 365 / Teams declarative agent that connects to our
existing remote MCP server so a Copilot or Teams user can query and log Palouse decisions
(and tasks, objectives, projects) in natural language from Copilot chat.

Microsoft's docs and terminology moved since the roadmap was written; the facts below were
re-verified against Microsoft Learn on 2026-07-12 (see Sources). Where the roadmap and the
current docs disagree, the current docs win.

## 1. What already exists (reuse, do not rebuild)

Grounded in the code on 2026-07-12:

- **Remote MCP server**: `apps/mcp`, served at `https://mcp.palouse.ai/mcp` (staging
  `mcp-test.palouse.ai`), stateless streamable HTTP, path `/mcp`
  (`apps/mcp/src/index.ts`). Health at `/healthz`.
- **OAuth provider**: `@better-auth/oauth-provider` wired in `packages/auth/src/mcp-oauth.ts`.
  DCR is **already enabled** (`allowDynamicClientRegistration: true`,
  `allowUnauthenticatedClientRegistration: true`). Endpoints:
  - authorize: `POST /api/auth/oauth2/authorize`
  - token: `POST /api/auth/oauth2/token`
  - JWKS: `GET /api/auth/jwks`
  - DCR register: `POST /api/auth/oauth2/register` (RFC 7591)
  - discovery: `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`
    (served by the API, proxied at origin root); `/.well-known/oauth-protected-resource[/mcp]`
    served by the MCP app.
- **Token verification + tenancy**: `apps/mcp/src/auth.ts` verifies the JWT locally against
  JWKS (no per-request round trip), pins issuer `${BETTER_AUTH_URL}/api/auth` and audience
  `${PUBLIC_MCP_URL}`, and reads `palouse_agent_id` / `palouse_workspace_id` / scopes from
  claims, then re-checks the grant with `assertMcpGrant`. Both agent API keys and OAuth
  bearer tokens ride the same `Authorization: Bearer` header.
- **Workspace selection + consent flow**: the interactive authorize flow routes the user
  through sign-in, `/mcp-connect/workspace` (pick a workspace), and `/mcp-connect/consent`;
  the choice is stored (`mcp_connect_selections`) and the consent's `referenceId` pins an
  `agentId` that gets stamped into every token from that grant
  (`apps/api/src/routes/mcp-connect.ts`, `packages/auth/src/mcp-oauth.ts`).
- **`oauthClients` table** already supports a fully specified client row (clientId,
  clientSecret, redirectUris, scopes, grantTypes, responseTypes, requirePKCE, public, ...):
  `packages/db/src/schema/oauth.ts`, migration `0017_mcp_oauth.sql`.
- **MCP tools available to the agent** include the full decisions surface plus
  `get_strategy_signals` (added 2026-07-12), objectives, projects, and tasks. A `'*'`
  full-access key auto-inherits new tools.

**Net:** the server and provider are ready. A2 is mostly OAuth-client provisioning, a Teams
app manifest, packaging, and verification. Little or no new decision code.

## 2. Verified Microsoft requirements (2026-07-12)

Terminology note: the roadmap said "manifest v2.4 RemoteMCPServer." Current docs use two
layered manifests: the **Teams app manifest** (schema v1.27) declares an `agentConnectors`
array; the **plugin manifest v2.4** carries the `runtime` MCP server spec + `auth` object.
Both reference an OAuth registration by id. The `agentConnectors` path is the current,
simplest shape.

### Manifest (Teams app manifest, root-level `agentConnectors`)

```json
"agentConnectors": [
  {
    "id": "palouse-mcp",
    "displayName": "Palouse",
    "description": "Query and log decisions, objectives, projects, and tasks.",
    "toolSource": {
      "remoteMcpServer": {
        "mcpServerUrl": "https://mcp.palouse.ai/mcp",
        "authorization": { "type": "OAuthPluginVault", "referenceId": "<dev-portal-oauth-registration-id>" }
      }
    }
  }
]
```

- `mcpServerUrl` must be HTTPS and respond to the MCP handshake; TLS 1.2+.
- **Tool discovery**: omit `mcpToolDescription` for **dynamic discovery** (the agent calls
  `tools/list` at runtime, no republish when tools change). Our server already serves
  `tools/list`, so dynamic discovery is the low-maintenance default. Provide a static
  `mcpToolDescription.description` (a `toolDescription.json` matching our `tools/list`
  schema) only if the Copilot surface we target does not honor dynamic discovery (see Risks).

### Authentication (OAuth 2.0 authorization code flow)

Supported `authorization.type` values for a remote MCP server: `None`, `OAuthPluginVault`
(static client, ID/secret in the Dev Portal vault), `DynamicClientRegistration` (points at
our RFC 7591 endpoint), `ApiKeyPluginVault`, `AzureKeyVault`.

Hard constraints (confirmed verbatim):

- **Authorization code flow only**, with optional PKCE.
- **The token endpoint must NOT return `307 Temporary Redirect`.** Servers that 307 from the
  token endpoint are unsupported.
- Add `https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect` as an allowed redirect
  URI in the OAuth provider registration (our `oauthClients.redirectUris`).
- Include `offline_access` in scope for refresh tokens.

### Teams Developer Portal OAuth client registration (for `OAuthPluginVault`)

Tools -> OAuth client registration -> fields:

- Registration name; **Base URL** (must correspond to the MCP server `url`, i.e.
  `https://mcp.palouse.ai`); Restrict usage by org (**Any Microsoft 365 organization** for a
  multi-tenant pilot, or My organization only for a single-tenant test); Restrict usage by
  app; **Client ID** + **Client secret** (from our provider); **Authorization endpoint**,
  **Token endpoint**, **Refresh endpoint** (our `/api/auth/oauth2/...` URLs); **Scope**
  (Palouse scopes + `offline_access`); Enable PKCE.
- Saving generates an **OAuth client registration id** -> this is the manifest
  `authorization.referenceId` (a.k.a. plugin-manifest `auth.reference_id`).

### Packaging / distribution

- Validate with the Developer Portal package validation tool.
- Pilot: per-tenant **custom app upload** (sideload). GA: **Partner Center / Agent Store**.

## 3. The key decision: static client vs DCR

The roadmap assumed a **static** client is mandatory ("no DCR for the declarative agent").
Current docs list **`DynamicClientRegistration`** as a supported agent-connector auth type,
and our provider already exposes RFC 7591 DCR. So there are two viable paths:

- **Path A - static (`OAuthPluginVault`)**: mint one static `oauthClients` row (fixed Teams
  redirect URI, our scopes, PKCE), register it in the Dev Portal with client id/secret + our
  endpoints. This is the path the Copilot plugin-authentication doc documents end to end, so
  it is the **lower-risk, confirmed** option. Cost: manage one client secret (rotation) and
  a small provisioning step.
- **Path B - DCR (`DynamicClientRegistration`)**: register a DCR config in the Dev Portal
  pointing at `POST /api/auth/oauth2/register`; Microsoft registers a client at runtime. No
  secret to mint or rotate, reuses what we already run for Claude/Cursor. Risk: DCR for the
  **Copilot declarative agent** surface specifically is newer and not covered by the
  Copilot-extensibility auth doc (only by the broader Teams agent-connectors doc), so it may
  not be honored on every Copilot surface yet.

**Recommendation:** spike Path B first (nothing to build; it reuses DCR) in a test tenant. If
the Copilot surface we target does not complete the DCR flow, fall back to Path A (a static
client is a single row plus a Dev Portal registration). Decide before writing the CLI in
slice 2. This resolves plan open question O6 (shared static client vs per-tenant) in favor of
"prefer DCR; if static, one shared client with Any-org restriction."

## 4. What we build / do (thin slice, then expand)

Most of A2 is configuration, a manifest, and verification, not repo code.

1. **Verify the OAuth provider satisfies Microsoft's constraints** (no new code if it
   passes):
   - The advertised **token endpoint returns 200 directly with no 307** (check trailing
     slash, http->https, apex/www redirects on the public URL; the discovery metadata must
     advertise the canonical URL).
   - PKCE is accepted on the authorize/token exchange.
   - A token minted for the Teams client carries **audience = `PUBLIC_MCP_URL`
     (`https://mcp.palouse.ai/mcp`)** and **issuer = `${BETTER_AUTH_URL}/api/auth`**, so
     `apps/mcp/src/auth.ts` accepts it unchanged.
   - `offline_access` yields a refresh token.
2. **Provision the OAuth client**:
   - Path B: register a DCR config in the Dev Portal (no repo change).
   - Path A: add a small `apps/cli` command (e.g. `register-oauth-client`) that inserts one
     `oauthClients` row with `redirectUris` including the Teams redirect URI, our scope
     allow-list + `offline_access`, `requirePKCE`, `grantTypes: [authorization_code,
     refresh_token]`. Output the client id (+ secret) and the JWKS/endpoint URLs for the Dev
     Portal form. (The only likely code in this slice.)
3. **Author the Teams app package** under a new `microsoft/copilot-agent/` (or
   `packages/teams-app/`) directory: app manifest with `agentConnectors` +
   `remoteMcpServer` + `authorization.referenceId`, a minimal declarative-agent definition,
   name/description/icons. Start with **dynamic tool discovery** (omit `mcpToolDescription`).
4. **Register the OAuth client in the Teams Developer Portal**, capture the registration id,
   and set it as `authorization.referenceId` in the manifest.
5. **Validate + sideload** to a test tenant (custom app upload). Drive the auth-code flow and
   confirm the interactive **sign-in -> workspace-selection -> consent** popup completes and
   returns to Teams, and that a tool call (e.g. `get_strategy_signals` or `list_decisions`)
   succeeds end to end.
6. **Docs**: `docs/guides/teams-copilot-agent.md` (provisioning, Dev Portal steps, sideload,
   the two admin/tenant toggles a customer needs). Update `docs/PLAN-mcp-oauth.md` to note
   the static-client / Teams path alongside the DCR path.
7. **GA later**: Partner Center submission (separate slice).

## 5. Risks and gotchas

- **307 on the token endpoint is a hard blocker.** Our public URLs must not redirect on the
  token endpoint. Verify the exact advertised URL first; this is the single most likely
  failure.
- **Interactive workspace selection inside the Teams OAuth popup.** Our authorize flow is
  multi-step (sign-in -> pick workspace -> consent). Standard browser auth-code flows work in
  the Teams popup, but the extra workspace-picker step is a UX risk; validate it early. If it
  is janky, consider a default-workspace fast path for single-workspace users.
- **Tool-description discovery may be surface-dependent.** Docs say dynamic discovery is
  supported (omit `mcpToolDescription`), but some Copilot surfaces have at times required
  static inline tool descriptions. Keep a generator that emits `toolDescription.json` from our
  `tools/list` as a fallback so we are not blocked.
- **Multi-tenant vs single-tenant registration.** "Any Microsoft 365 organization" is needed
  for a cross-tenant pilot; a shared static client + Any-org is simplest. Confirm this meets
  Microsoft's redirect-URI/app-restriction expectations.
- **Token audience/issuer drift.** If the Teams-minted token's audience is not exactly
  `PUBLIC_MCP_URL`, the MCP server rejects it. Verify against a real token, not assumptions.
- **Credential clearing.** Declarative agents cache OAuth tokens (Bot Framework Token
  Service); there is no user-facing "clear credentials." Plan a server-side sign-out / grant
  revocation story for support.
- **Licensing/positioning (not a build blocker):** Copilot-licensed users get declarative
  agents at no extra charge; Copilot Chat-only users incur metered Copilot Credits when the
  agent touches tenant data. Call this out in pricing conversations.

## 6. Open questions for the user

1. **DCR vs static client (section 3).** Spike DCR first, or go straight to a static client?
   Recommendation: spike DCR in a test tenant; fall back to static.
2. **Which tools does the Copilot agent expose?** All current tools (tasks, decisions,
   objectives, projects, `get_strategy_signals`), or a decisions-focused subset for the first
   pilot? A `'*'`-scope OAuth client sees everything; a narrower scope set limits it.
3. **Where does the Teams app package live** in the repo: `microsoft/copilot-agent/`,
   `packages/teams-app/`, or a separate ops repo? (No strong preference; recommend an
   in-repo `microsoft/copilot-agent/` dir so the manifest is versioned with the server.)
4. **Pilot tenant.** Which tenant do we sideload into for the first end-to-end test (our own
   palouse.io tenant vs a customer's)?
5. **Naming/branding** of the agent surface (display name, description, icons) shown in
   Copilot/Teams.

## 7. Tracer-slice breakdown (effort S/M)

1. **Spike + verify (S).** In a test tenant: confirm no-307 token endpoint, PKCE, token
   audience/issuer, `offline_access`; try DCR (Path B) as the auth type. Decide A vs B. No
   production code. This is the pause-for-feedback point.
2. **Provision + manifest (S-M).** Provision the client (DCR config, or the static-client CLI
   + row for Path A), author the Teams app package with dynamic discovery, register the OAuth
   client in the Dev Portal, wire `referenceId`.
3. **Sideload + validate end to end (S).** Custom-app upload to the pilot tenant; validate the
   auth-code + workspace-selection flow and a live tool call; write the guide.
4. **GA (later, separate).** Partner Center submission; optional static `toolDescription.json`
   if required by the target surface.

## 8. Explicitly out of scope

The Teams meeting transcript connector (A3), the extraction pipeline and its LLM dependency
(A1/A4), Meeting AI Insights (A5), and any decision-inbox UI. A2 is only the declarative
agent over the existing MCP server. Those land in later Theme A slices.

## Sources (Microsoft Learn, retrieved 2026-07-12)

- Register MCP Servers as Agent Connectors for Microsoft 365 (Teams):
  https://learn.microsoft.com/en-us/microsoftteams/platform/m365-apps/agent-connectors
- Configure Authentication for MCP and API plugins in Microsoft 365 Copilot:
  https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-authentication
