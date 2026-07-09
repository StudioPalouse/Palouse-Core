# Fieldwork design-system cards

Self-contained HTML preview cards for the **Fieldwork** design language
(`docs/design-system.md`). These are the local source for the **Palouse Fieldwork**
project in Claude Design (claude.ai/design), pushed via the `DesignSync` tool /
`/design-sync` workflow.

Each card is a standalone HTML document that mirrors the tokens shipped in
`apps/web/src/app/globals.css`. The first line of each file carries a
`<!-- @dsCard group="..." -->` marker used to place it in the Design System pane.

| Card | Group | Mirrors |
|---|---|---|
| `color-palette.html` | Color | Forest / Fern / Harvest anchors + tinted neutrals |
| `status.html` | Color | `--status-*` tokens (open/progress/blocked/done/active) |
| `charts.html` | Data viz | `--chart-1..5` categorical slots |
| `typography.html` | Type | IBM Plex Sans scale + weights, Plex Mono |
| `buttons.html` | Components | Button variants incl. growth-only Harvest |
| `badges.html` | Components | Pill status badges + forest-to-gold progress |

Keep these in sync when token values change so the design project stays true to
the code. Values iterate in tweakcn during rollout; re-validate chart hexes if any
change.
