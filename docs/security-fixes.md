# Security remediation backlog

This document records the findings from the July 2026 adversarial code review.
It is a remediation backlog, not evidence that any production account or
workspace has been compromised.

## Prioritization

| Priority | Finding | Risk |
| --- | --- | --- |
| P0 | Cross-workspace API-key revocation | An administrator in one workspace can revoke a known API key belonging to an agent in another workspace. |
| P0 | MCP OAuth access survives member removal | A removed or deactivated user can retain OAuth-backed MCP access through refresh tokens and existing access tokens. |
| P1 | Webhook secrets can be forged or replaced | A known integration ID can be used to replace an Asana webhook secret or forge Microsoft Graph notifications. |
| P1 | No explicit request abuse controls | Public and authenticated endpoints lack consistent request-size limits, rate limiting, and explicit CSRF protections for custom API routes. |
| P1 | Connector OAuth callback does not recheck authorization | A user removed after starting OAuth can still attach an integration during the signed state lifetime. |
| P2 | Agent-key revocation is delayed by cache | A revoked API key can remain usable for up to five minutes. |
| P2 | Social-provider tokens are stored in plaintext | Enabling social login stores provider access, refresh, and ID tokens in plaintext columns. |
| P2 | Local deployment and repository hygiene | A Redis dump is tracked, images are not digest-pinned, and the Compose stack publishes development services and credentials. |
| P3 | Browser security headers are absent | The web and API applications do not define a Content Security Policy or other standard hardening headers. |

## P0. Scope API-key revocation before mutation

**Affected code:** `packages/core/src/agents/service.ts`, `revokeApiKey`.

### Problem

`revokeApiKey` updates `agent_api_keys` using only the key and agent IDs, then
checks whether the agent belongs to `workspaceId`. If an administrator can
obtain an agent ID and key ID from another workspace, the key is revoked before
the later workspace check returns `notFound`.

### Remediation

Perform the workspace check as part of the mutation, before any state changes.
Use a transaction or a single `UPDATE ... FROM agents` statement constrained by
all of the following:

- `agent_api_keys.id = keyId`
- `agent_api_keys.agent_id = agentId`
- `agents.workspace_id = workspaceId`
- `agent_api_keys.revoked_at IS NULL`

Return `notFound` without changing anything when the scoped update affects no
rows. Keep the audit insert in the same transaction as the successful update.

### Acceptance criteria

- An admin in workspace A cannot change a key belonging to workspace B.
- A failed cross-workspace request does not modify `revoked_at` or create an
  audit event.
- Successful revocation remains idempotent in its public behavior.
- Add an integration test covering two workspaces and a key in each.

## P0. Revoke MCP OAuth authority when membership changes

**Affected code:** `packages/auth/src/mcp-oauth.ts`, `apps/mcp/src/auth.ts`,
`packages/core/src/workspaces/service.ts`, and the OAuth grant tables.

### Problem

The MCP verifier checks that the agent is not archived and that its workspace
matches the JWT claim. It does not check whether the user who granted consent
is still an active member. Deactivation and removal change membership state but
do not revoke the user's OAuth consents, refresh tokens, or access tokens.

### Remediation

Treat OAuth MCP authorization as delegated user authority rather than solely
agent authority.

- Preserve the authorizing user ID alongside the consent and token reference.
  The OAuth tables already contain `userId`; use it as the authoritative
  principal for MCP grants.
- When verifying an MCP OAuth token, validate that the token subject and the
  consent user remain active members of the token's workspace.
- In membership deactivation and removal flows, revoke that user's MCP OAuth
  refresh tokens, opaque access tokens, and consents for the workspace. Ensure
  existing JWTs are rejected as soon as membership is no longer active.
- Recheck active membership when minting or refreshing access tokens.
- Define the desired multi-admin behavior explicitly. Revoking one user's
  consent should not archive a shared agent that another active user has also
  authorized.

### Acceptance criteria

- A deactivated or removed user cannot use an existing MCP JWT.
- That user cannot refresh an MCP access token.
- An active user's separate consent to the same MCP client and workspace still
  works after another user's removal.
- Add tests for deactivate, remove, access-token use, and refresh-token use.

## P1. Harden webhook registration and verification

**Affected code:** `apps/api/src/routes/webhooks.ts`,
`packages/connectors/microsoft-todo/src/index.ts`, and integration persistence.

### Problem

The Asana handler accepts any request containing `X-Hook-Secret` and overwrites
the stored secret. The Microsoft Graph adapter uses the integration UUID as
`clientState`, and the receiver accepts a notification when that predictable
value appears anywhere in the request body. Integration IDs are exposed in
callback URLs and are not authentication secrets.

### Remediation

- Generate a cryptographically random, single-use webhook route nonce before
  registering a subscription. Store only a hash, include it in the callback
  URL, and accept an Asana handshake only while that nonce is pending and
  unexpired.
- Do not overwrite an established Asana secret from a subsequent handshake.
  Require an explicit resubscription transition to rotate it.
- Generate a separate random Microsoft Graph `clientState` value, store it
  encrypted or hashed, and compare it with constant-time equality. Do not use
  the integration ID as a secret.
- Verify that every notification belongs to the expected subscription and
  provider before queuing work.
- Cap webhook body size, rate-limit unknown integration IDs, and record
  security telemetry for handshake and signature failures without logging
  secret values.

### Acceptance criteria

- A replayed or unsolicited Asana handshake cannot replace a stored secret.
- A Graph request containing only a known integration ID is rejected.
- Valid provider notifications still enqueue exactly one sync job.
- Tests cover malicious handshakes, secret rotation, forged client state,
  duplicate deliveries, and oversized payloads.

## P1. Add request and browser abuse controls

**Affected code:** `apps/api/src/app.ts`, API route handlers, web proxy, and
deployment edge configuration.

### Problem

The API sets a narrow CORS policy, but CORS is not a request-side CSRF defense.
Custom cookie-authenticated mutation routes do not enforce Origin or Referer
validation. There are also no application-level rate limits or consistent body
limits before JSON, OTLP, CSV, and webhook payloads are read into memory.

### Remediation

- For every unsafe, session-authenticated `/v1` request, require an expected
  `Origin` header and reject cross-origin requests. Use a CSRF token as a
  second defense if direct API deployment remains supported.
- Require `Content-Type: application/json` where JSON is expected.
- Apply explicit content-length and streamed body limits before parsing.
  Configure lower limits for webhooks and auth routes, and a documented limit
  for OTLP and CSV imports.
- Add rate limits at the edge and application layers. Protect sign-in,
  password reset, sign-up, OAuth start and callback, webhook paths, MCP token
  verification, OTLP ingestion, and expensive list/search endpoints.
- Return `429` with a safe retry signal and instrument rate-limit decisions.

### Acceptance criteria

- Cross-origin unsafe requests with a session cookie are rejected.
- Oversized requests are rejected before allocating an unbounded body.
- Repeated invalid credentials, webhook requests, and OTLP submissions receive
  bounded responses and cannot exhaust application resources.
- Rate-limit configuration is documented for self-hosted deployments.

## P1. Revalidate workspace role after connector OAuth callback

**Affected code:** `apps/api/src/routes/oauth.ts` and
`packages/connectors/core/src/state.ts`.

### Problem

OAuth state correctly has an HMAC and ten-minute expiry, but its callback uses
the stored workspace and user identifiers without confirming that the user is
still an active workspace owner or admin. A user removed during the OAuth flow
can still attach their external account to the workspace.

### Remediation

After state verification and before exchanging the code or persisting tokens,
call `workspaces.requireRole` using `payload.workspaceId`, `payload.userId`,
and `['owner', 'admin']`. Return the user to a safe settings URL with a generic
authorization error when the check fails. Consider storing one-time state IDs
server-side to prevent repeated callback attempts and provide explicit flow
revocation.

### Acceptance criteria

- Removing the user after OAuth start prevents integration creation.
- A valid active admin can still complete the normal OAuth flow.
- The callback does not disclose whether the workspace still exists to an
  unauthenticated caller.

## P2. Make API-key revocation immediate

**Affected code:** `packages/core/src/agents/service.ts`.

### Problem

Successful key verification is cached by raw key for five minutes. Revoked keys
therefore continue to authenticate until the local cache entry expires. This is
especially problematic during incident response.

### Remediation

- Evict the key from every verifier cache during revocation, or replace the
  process-local cache with a short-lived shared cache that supports deletion.
- Prefer cache entries keyed by key ID or a derived key fingerprint rather than
  retaining raw bearer credentials in process memory.
- If a short grace period is intentionally retained, document it as a product
  behavior and provide an emergency revocation path that bypasses it.

### Acceptance criteria

- A revoked API key is rejected on the next request.
- Key values are not retained as long-lived cache map keys.
- Tests verify revocation when a successful verification was previously cached.

## P2. Encrypt social-provider tokens or avoid retaining them

**Affected code:** `packages/db/src/schema/identity.ts` and Better Auth setup.

### Problem

The Better Auth `accounts` table has plaintext columns for provider access,
refresh, and ID tokens. Connector OAuth tokens correctly use AES-256-GCM, but
social-login tokens do not receive the same protection when social providers
are enabled.

### Remediation

- Determine whether social-login provider tokens are required after identity
  verification. If not, configure the auth integration not to persist them.
- If retained, encrypt them with application-layer envelope encryption using a
  managed key, separate from database backups and routine database access.
- Support key versioning and rotation, and redact these fields from logs,
  exports, diagnostics, and support tooling.

### Acceptance criteria

- A database-only compromise does not reveal usable social-provider tokens.
- Key rotation can decrypt existing records and encrypt new records with the
  new key version.
- Tests exercise encryption, decryption, absent-token cases, and rotation.

## P2. Repository and local deployment hygiene

**Affected code:** `dump.rdb`, `.gitignore`, `docker-compose.yml`, and Dockerfiles.

### Remediation

- Remove the tracked `dump.rdb` file and add `*.rdb` to `.gitignore`. Review
  repository history and rotate credentials if a future or historical dump
  contained production data.
- Mark Compose configuration as local development only. Bind Postgres, Redis,
  MinIO, API, and MCP ports to loopback by default, or omit host ports that are
  unnecessary.
- Do not reuse development credentials outside local development.
- Pin base and service images to reviewed version digests. In particular,
  replace floating tags such as `minio/minio:latest`.
- Run containers as non-root where compatible and add image vulnerability
  scanning to CI.

### Acceptance criteria

- No runtime data dumps or real secrets are tracked by Git.
- A default local stack is not reachable from the LAN.
- Production deployment manifests use reviewed immutable image references.

## P3. Add browser and HTTP security headers

**Affected code:** API middleware, Next.js configuration, and deployment edge.

### Remediation

- Set a restrictive Content Security Policy appropriate for Next.js and the
  authentication pages. Begin in report-only mode if needed.
- Add `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, `frame-ancestors` through CSP, and HSTS at the HTTPS
  edge.
- Verify that OAuth callbacks, MCP discovery, and any required external assets
  remain functional under the policy.

### Acceptance criteria

- Header tests cover web pages, API responses, OAuth pages, and MCP discovery.
- The production CSP has no broad wildcard or unsafe-script exception unless it
  is documented and required.

## Verification plan

1. Add focused regression tests for every P0 and P1 finding before merging its
   fix.
2. Run the full test suite with a container runtime so the Postgres-backed core
   tests execute rather than skip.
3. Add authenticated API integration tests for cross-workspace access, member
   revocation, OAuth refresh, and webhook verification.
4. Add dependency and container-image scanning in CI. The review environment
   could not complete `pnpm audit` because registry DNS was unavailable.
5. Perform a staging retest using separate workspaces, an OAuth MCP client,
   and provider webhook test tools before production rollout.

## Existing positive controls

The review also confirmed several sound controls worth preserving:

- Agent API-key secrets are Argon2id-hashed.
- Connector OAuth tokens and webhook secrets use AES-256-GCM encryption.
- Connector OAuth state is HMAC-signed and expires.
- Asana event signatures use constant-time comparison.
- Markdown is rendered without raw HTML.
- Most user-facing service operations validate workspace membership or role
  before accessing workspace data.
