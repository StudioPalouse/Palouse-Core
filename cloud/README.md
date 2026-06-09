# Cloud (hosted-only) packages

Everything in this directory is licensed under **Business Source License 1.1** and is
**not included in the OSS build**. These packages exist to provide functionality that
only matters when ReqOps is operated as a multi-tenant service for other organizations:

- `billing/` — Stripe integration + plan enforcement middleware
- `sso-saml/` — SAML + SCIM provisioning
- `audit-export/` — Streaming audit log export (S3 / Datadog / customer bucket)
- `mcp-gateway/` — Multi-tenant MCP edge with per-tenant rate limits

The OSS Apache-2.0 build (`pnpm install --filter '!@reqops/cloud-*'`) excludes this
directory entirely. See `docs/architecture.md` §7 for the open-core split.

Each package's `LICENSE` will read `BUSL-1.1` with a 3-year change date to Apache-2.0.
