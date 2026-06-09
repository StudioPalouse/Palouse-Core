# ReqOps

**Team task aggregation + agentic handoff.** Aggregate work from Google Tasks,
Microsoft To Do / Planner, and Asana into one inbox, then hand individual tasks
off to MCP-capable agents (Claude, Paperclip, Cursor, custom) that execute on
behalf of a human and report back.

Open core: full product is Apache-2.0 and self-hostable. Hosted SaaS layers a
small set of BSL-licensed cloud features on top of the same code.

> Status: v0.0 — repository scaffold. Active milestone: **M1 — Repo skeleton & infra**.
> See [`docs/architecture.md`](./docs/architecture.md) for the complete plan.

## Quick start (dev)

Prereqs: Node 22+, pnpm 10+, Docker.

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # postgres + redis only
cp .env.example .env                              # or: pnpm reqops init
pnpm db:generate && pnpm db:migrate
pnpm dev
```

Open <http://localhost:3000>.

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
