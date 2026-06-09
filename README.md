# ReqOps

**Team task aggregation + agentic handoff.** Aggregate work from Google Tasks,
Microsoft To Do / Planner, and Asana into one inbox, then hand individual tasks
off to MCP-capable agents (Claude, Paperclip, Cursor, custom) that execute on
behalf of a human and report back.

Open core: full product is Apache-2.0 and self-hostable. Hosted SaaS layers a
small set of BSL-licensed cloud features on top of the same code.

> Status: v0.0 — M3 in progress (connector framework). M2 (tasks core + unified
> inbox) works end-to-end; Google Tasks and Asana connectors sync through the
> worker: OAuth connect, encrypted token storage, incremental pull, Asana
> webhooks with polling fallback, and outbound push of ReqOps edits.
> See [`docs/architecture.md`](./docs/architecture.md) for the complete plan.

## Quick start (dev)

Prereqs: Node 22+, pnpm 10+, Docker (or local Postgres 16 + Redis 7).

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # postgres + redis only
pnpm reqops init                                  # writes .env with random secrets
pnpm db:migrate
pnpm reqops seed                                  # optional: demo user + workspace + tasks
pnpm dev
```

Open <http://localhost:3000> and sign in with the seeded account
(`demo@reqops.local` / `reqops-demo-password`), or sign up fresh.
The API serves <http://localhost:4000> (`/health`, `/v1/*`, Better-Auth under `/api/auth`).

No Docker? Point `DATABASE_URL` / `REDIS_URL` in `.env` at any local Postgres 16
and Redis 7 — `.env` is auto-loaded by every app in dev.

### Connectors

Connecting Google Tasks or Asana from Settings requires OAuth apps of your own:
set `GOOGLE_OAUTH_CLIENT_ID/SECRET` and/or `ASANA_OAUTH_CLIENT_ID/SECRET` in
`.env`, with redirect URI `http://localhost:4000/oauth/<provider>/callback`.
Google Tasks is polled every 60s. Asana subscribes a webhook when
`API_BASE_URL` is publicly reachable and otherwise falls back to 5-minute
polling. Editing a synced task in ReqOps pushes the change back to the source
system. For connector development without real credentials,
`@reqops/testing` ships a fake Asana server and the adapters honor
`REQOPS_ASANA_API_BASE` / `REQOPS_GOOGLE_TASKS_API_BASE` overrides.

### UI

`packages/ui` is a [shadcn/ui](https://ui.shadcn.com)-based component library on
Tailwind v4 — stock base theme, neutral palette, no customization. Navigation is
deliberately minimal: a single top bar (Inbox · Settings · sign out).

## Full self-host

```bash
cp .env.example .env
docker compose up -d
```

Brings up `postgres`, `redis`, `minio`, `api`, `web`, `worker`, `mcp`.

## Repository layout

```
apps/         web · api · worker · mcp · cli
packages/     db · auth · core · shared · ui · config · queue · mcp-sdk · testing
              connectors/{core,google-tasks,asana,microsoft-todo,microsoft-planner}
              agent-adapters/{core,paperclip}
cloud/        Hosted-only, BSL-licensed (billing · sso-saml · audit-export · mcp-gateway)
docs/         architecture.md (the master plan)
```

## Architecture

See [`docs/architecture.md`](./docs/architecture.md) for the full design:
data model, sync architecture, handoff lifecycle, MCP server design,
open-core split, deployment topology, and the M1 → M6 execution roadmap.

## License

Apache-2.0 for the OSS core. The `cloud/` directory is BSL-1.1 with a 3-year
change date to Apache-2.0. See [`LICENSE`](./LICENSE) and [`cloud/README.md`](./cloud/README.md).
