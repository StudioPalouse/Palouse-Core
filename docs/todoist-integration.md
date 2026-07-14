# Palouse — Todoist Integration

> **Backlog tracked in Specboard.** Remaining work is under the **Todoist connector** epic
> (release **Integrations**): slice 2 webhooks, project-name grouping, and priority/deletion
> handling. Slice 1 has shipped (v0.11.0). Specboard owns status; this document is retained as
> integration reference. Reconciled 2026-07-14.

Status: **slice 1 implemented** (OAuth connect + incremental pull + push write-back,
poll-only). Webhooks are slice 2. Companion to `docs/architecture.md` §4 and the
connector playbook in `docs/notion-integration.md`.

Built against the **unified Todoist API v1** (`https://api.todoist.com/api/v1`),
which replaced REST v2 and Sync v9 in 2025. Verified against the live docs
(July 2026).

## How the connector works

- Package: `packages/connectors/todoist` (`todoistAdapter`), registered in
  `apps/api/src/connectors.ts` and `apps/worker/src/adapters.ts`.
- **Pull**: `POST /api/v1/sync` with `resource_types: ["items"]`. The returned
  `sync_token` is stored as the sync cursor; the first pull sends `*` (all active
  items), later pulls return only changed items, including ones completed or
  deleted since. Deleted items are skipped; `checked` maps to status `done`.
  Tasks completed before the first sync are not imported (they live in Todoist's
  archive and are not part of a full sync).
- **Push**: field edits via `POST /api/v1/tasks/{id}`; status via
  `/tasks/{id}/close` and `/tasks/{id}/reopen`. Clearing a due date uses
  Todoist's documented `due_string: "no date"` sentinel.
- **Polling**: every 120s (`POLL_INTERVAL_MS`). Incremental sync calls are cheap;
  Todoist allows 450 partial-sync requests per 15 minutes per user.
- **Tokens**: apps created in the Todoist console today issue 1-hour access
  tokens plus a refresh token; the adapter's `refreshTokens` handles rotation
  and the worker refreshes just before expiry. Legacy apps (10-year tokens, no
  `refresh_token`) simply never trigger a refresh.
- Test override: set `PALOUSE_TODOIST_API_BASE` to point the adapter at a fake
  server.

## OAuth app setup (one-time, per environment)

1. Create an app at <https://app.todoist.com/app/settings/integrations/app-management>
   (App Management console). One app per environment; a Todoist app supports
   multiple redirect URIs, but separate apps keep staging and prod secrets
   isolated (see `docs/production-setup.md`: never reuse staging values).
2. Set the OAuth redirect URL to `https://<API_BASE_URL host>/oauth/todoist/callback`:
   - prod: `https://app.palouse.ai/oauth/todoist/callback`
   - staging: `https://test.palouse.ai/oauth/todoist/callback`
   - local dev: `http://localhost:4000/oauth/todoist/callback`
3. Copy the client ID and secret into `TODOIST_OAUTH_CLIENT_ID` /
   `TODOIST_OAUTH_CLIENT_SECRET`. Both the **api** (code exchange) and
   **worker** (token refresh) apps need them: `.env` locally,
   `scripts/fly-secrets.sh` for staging, `fly secrets set` per
   `docs/production-setup.md` §P5 for prod.
4. Requested scope is `data:read_write` (read tasks + write-back). No app review
   is required for OAuth; submission to the Todoist app directory is optional
   and only needed for public listing.

## Slice 2 (not yet built)

- **Webhooks**: Todoist delivers webhooks per app (configured in the app console,
  one URL for all users) with an HMAC-SHA256 `X-Todoist-Hmac-SHA256` signature.
  Receiver branch goes in `apps/api/src/routes/webhooks.ts` (follow the Asana
  pattern); events of interest: `item:added`, `item:updated`, `item:completed`,
  `item:deleted`. Polling stays as the fallback, at a relaxed cadence.
- Project names as a grouping signal (pull `projects` alongside `items`).
- Priority mapping (Todoist `priority` 1-4 → Palouse priority) and deletion
  propagation, once the internal model supports external deletes.
