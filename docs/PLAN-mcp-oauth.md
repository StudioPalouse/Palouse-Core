# PLAN: OAuth sign-in for the MCP endpoint

Status: slice 1 in progress (2026-07-07). Owner: JB.

## Why

Today connecting an agent means: open Settings, create an agent, mint a key, copy the
key into the client config. Products like Aha and Miro let users paste an MCP URL into
Claude/ChatGPT/Cursor and sign in with their normal credentials. That experience is the
MCP spec's OAuth 2.1 authorization flow (RFC 8414 discovery + RFC 7591 dynamic client
registration + PKCE), and Better Auth ships a plugin that turns our existing auth
server into the authorization server for it.

Decision (2026-07-07): build it with `@better-auth/oauth-provider` (the successor of
the deprecating `mcp` plugin; version-locked to our `better-auth` 1.6.23). Workspace
selection happens explicitly during the connect flow so the user always knows which
workspace the client is tapping into. Everything else stays as close to today's
key-based model as possible: same agent records, same scopes, same audit trail, and
agent keys keep working unchanged as the manual/self-hosted path.

## The flow (user's view)

1. User pastes `https://mcp.palouse.ai/mcp` into their MCP client.
2. Client discovers our authorization server and registers itself (no manual client IDs).
3. Browser opens: sign in at app.palouse.ai (existing page, skipped if already signed in).
4. New page: "Choose a workspace" (only workspaces where the user is owner/admin).
5. New page: consent ("Claude wants to access <workspace> with these scopes") with
   Approve / Deny.
6. Client receives tokens and starts calling `/mcp` with a Bearer JWT.

## How it maps onto the stack

Authorization server = the API (`apps/api`), where Better Auth already lives, public at
`https://app.palouse.ai/api/auth` through the web rewrite proxy. Resource server = the
MCP app (`apps/mcp`) at `https://mcp.palouse.ai/mcp`.

- **`packages/auth`**: add the `jwt()` plugin (JWKS signing) and `oauthProvider()`:
  dynamic client registration on, PKCE required (plugin default), scopes = our agent
  scopes (`tasks:read` ... `projects:write`, `handoffs:claim`, `handoffs:complete`,
  `usage:write`) plus `offline_access` for refresh tokens.
- **Workspace selection** uses the plugin's `postLogin` hook (built for exactly this:
  org/team selection before consent). The selection page stores the choice server-side
  keyed by session; `postLogin.consentReferenceId` then ties an **agent id** to the
  consent as its `reference_id`. `customAccessTokenClaims` copies the agent's
  workspace/agent ids into every access token minted from that consent, so tokens are
  self-describing and two connections to different workspaces never interfere.
  The hook's contract: `shouldRedirect` must return false once the step is satisfied
  (it is re-consulted when the page calls `/oauth2/continue`), so a stored selection
  satisfies it for 10 minutes. Consequence: reconnecting within 10 minutes of a prior
  connect in the same browser session skips the picker and reuses that selection (the
  consent screen still names the workspace); after that it always re-asks.
- **Agent identity stays as today**: approving consent finds-or-creates an `agents` row
  (kind `mcp_generic`, metadata records the OAuth client id + connecting user) in the
  chosen workspace. Tool gating, capability checks, and `audit_events` all keep working
  off that agent id with zero changes downstream.
- **`apps/api`**: serve `/.well-known/oauth-authorization-server` and
  `/.well-known/openid-configuration` (plugin helpers export these as fetch handlers;
  they cannot live under `/api/auth` because RFC 8414 requires the well-known path at
  the origin root), plus `POST /v1/mcp-connect/selection` (session-authed, owner/admin
  on the chosen workspace, mirroring who may mint agent keys today).
- **`apps/web`**: rewrite `/.well-known/oauth-*` to the API alongside the existing
  `/api/*` proxy; add `/mcp-connect/workspace` (selection) and `/mcp-connect/consent`
  pages. Sign-in page is reused as `loginPage`.
- **`apps/mcp`**: unauthenticated requests get `401` +
  `WWW-Authenticate: Bearer resource_metadata="..."`; serve
  `/.well-known/oauth-protected-resource` (via the plugin's resource client);
  `auth.ts` accepts both credentials on the same header: `palouse_agk_*` verifies as an
  agent key exactly as today, anything else verifies as a JWT against the auth server's
  JWKS (issuer/audience pinned, local verification, no per-request round trip) and maps
  claims into the same `VerifiedAgentKey` shape the rest of the server consumes.

## Storage (migration 0017)

Plugin-managed tables, uuid PKs minted by Postgres like our other Better Auth tables:
`oauth_clients`, `oauth_consents`, `oauth_refresh_tokens`, `oauth_access_tokens`
(opaque-token fallback; JWTs are the normal path), and `jwks` for the jwt plugin.
Plus `mcp_connect_selections` (session-keyed workspace/agent choice bridging the
selection page to `consentReferenceId`).

Secrets hygiene matches agent keys: client secrets and opaque tokens are stored hashed
(plugin default), refresh tokens are opaque and hashed.

## Slices

**Slice 1 (this branch): the tracer bullet.**
Everything above, verified locally end to end (discovery, registration, sign-in,
workspace pick, consent, JWT-authed `initialize` + `list_tasks`). Granted scope set =
everything advertised (consent screen lists them); per-scope pick-and-choose UI comes
later. Staging dogfood via `claude mcp add --transport http`.

**Slice 2 (UX surfacing): DONE.**
- Connect-agent dialog now leads with "Sign in" (paste the MCP endpoint, run
  `claude mcp add --transport http <alias> <url>` with no bearer, sign in). The old
  name + scopes + mint-a-key flow is the second "API key" tab for clients that cannot
  sign in or for self-hosted stdio.
- OAuth connections are surfaced in Settings > Agents: a "Sign-in" badge in the list,
  and on the detail page a "Connection" section (connected date, "Revoke access")
  instead of the key-oriented "API keys"/"Remove" sections. Detection is
  `metadata.oauthClientId` (helper `isOAuthAgent`).
- Archive is now a full OAuth revoke: `archiveAgent`/`deleteAgent` delete the agent's
  `oauth_consents` + `oauth_refresh_tokens` + `oauth_access_tokens` (keyed by
  `referenceId = agentId`). The stateless access-token JWT is already refused by the
  archived-agent check at verify time; clearing the grants stops refresh and forces
  re-consent on reconnect. Verified locally for both agent types.

**Slice 3 (still deferred, in rough order):**
- Last-used / activity timestamp for OAuth connections (they have no `agent_api_keys`
  row, so no `lastUsedAt` today; could derive from `audit_events` or stamp the agent).
- Granular scope selection on the consent screen (today: consent grants the full
  advertised set).
- Trusted first-party clients (skip consent) if we ship our own clients.
- Policy question: allow `member` role to self-connect (today: owner/admin only,
  matching key minting).

## Risks / notes

- The web proxy fronts the authorization endpoints; DCR (`POST /api/auth/oauth2/register`)
  and token exchange ride the existing rewrite. Watch body-size/CORS behavior there.
- `BETTER_AUTH_URL` (issuer) is `https://app.palouse.ai`; MCP app already has it in its
  Fly config for verification pinning. Audience = `https://mcp.palouse.ai/mcp`
  (`PUBLIC_MCP_URL`), advertised via `validAudiences`.
- Postgres auto-stop on staging: first OAuth round trip after idle may be slow; fine.
- The old `mcp` Better Auth plugin is not used anywhere; nothing to migrate.
