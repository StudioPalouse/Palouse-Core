# Glossary

Canonical definitions for Palouse's core entities. Use these terms consistently
in code, UI copy, docs, and conversation. "Account" was historically overloaded;
these definitions are the source of truth.

## Organization

The top-level entity for a customer. An organization can contain multiple
workspaces and owns billing. Table: `organizations` (`packages/db/src/schema/identity.ts`).

Today each organization backs a single workspace 1:1 (`createWorkspace` creates a
matching org), and the org layer is not yet surfaced in the UI beyond the
owner-only Settings → Organization tab. True multi-workspace organizations come
later.

## Workspace

The account-level tenant boundary: the container that tasks, agents, integrations,
members, and everything else belong to. Most customers use a single workspace.
Table: `workspaces`. Nearly every domain table carries a `workspace_id`.

When users delete "their account" they are deleting a **workspace** (which cascades
to the backing organization). That flow is named `workspace deletion` throughout:
route `/workspaces/delete`, `POST /v1/workspaces/deletion/confirm`,
`requestWorkspaceDeletion`/`confirmWorkspaceDeletion`, and the
`workspace_deletion_tokens` table.

## User Account

A person: a human who signs in. A user relates to one or more workspaces through a
**membership** that carries a role (`owner`, `admin`, `member`, `viewer`) and a
status (`active`, `inactive`). Tables: `users` + `memberships`.

Personal user settings (name, email, photo, password, theme) live at `/account`,
separate from the workspace-scoped Settings area.

## Not to be confused with: the `accounts` table

Better-Auth manages a table literally named `accounts`. It stores **OAuth provider
credentials** (provider id, tokens, hashed password) linked to a user. It has
nothing to do with the customer-facing "account." Do not reference it when you mean
Organization, Workspace, or User Account.

## Quick reference

| Term         | Means                                  | Primary table(s)             |
| ------------ | -------------------------------------- | ---------------------------- |
| Organization | Top-level customer, holds workspaces   | `organizations`              |
| Workspace    | Account-level tenant; where work lives | `workspaces`                 |
| User Account | A person who signs in                  | `users` + `memberships`      |
| (`accounts`) | Better-Auth OAuth credentials, unrelated | `accounts`                 |
