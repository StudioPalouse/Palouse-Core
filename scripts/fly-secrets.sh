#!/usr/bin/env bash
# Sync .env.staging to the Fly backend apps (api, worker, mcp).
# Web gets no secrets: its only env (NEXT_PUBLIC_API_URL) is baked at build time.
#
# Usage: ./scripts/fly-secrets.sh [env-file]   (default: .env.staging)
set -euo pipefail

ENV_FILE="${1:-.env.staging}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found — cp .env.staging.example .env.staging and fill it in" >&2
  exit 1
fi

# Drop comments, blank lines, and unfilled keys (KEY= with no value).
SECRETS="$(grep -vE '^[[:space:]]*(#|$)' "$ENV_FILE" | grep -vE '^[A-Z_]+=$')"

if grep -qE '<[A-Z_]+>' <<<"$SECRETS"; then
  echo "error: $ENV_FILE still contains <PLACEHOLDER> values" >&2
  exit 1
fi

for app in reqops-staging-api reqops-staging-worker reqops-staging-mcp; do
  echo "==> $app"
  fly secrets import --app "$app" <<<"$SECRETS"
done

echo "Done. Secrets staged; they apply on next deploy (or immediately if machines were running)."
