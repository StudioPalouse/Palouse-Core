#!/usr/bin/env bash
# One-time provisioning of the Palouse staging environment on Fly.io.
# Idempotent: safe to re-run; existing apps are skipped.
#
# Prereqs: `fly auth login` done; FLY_ORG (default: palouse).
set -euo pipefail

ORG="${FLY_ORG:-palouse}"
REGION="${FLY_REGION:-iad}"
APPS=(palouse-staging-api palouse-staging-web palouse-staging-worker palouse-staging-mcp)

echo "==> Creating Fly apps in org '$ORG'"
for app in "${APPS[@]}"; do
  if fly apps list --org "$ORG" --json | grep -q "\"$app\""; then
    echo "    $app already exists — skipping"
  else
    fly apps create "$app" --org "$ORG"
  fi
done

echo "==> Creating Fly Managed Postgres (development plan — minimal staging footprint)"
# MPG is a managed cluster (not a standalone app), so it appears in `fly mpg list`,
# not `fly apps list` — same model as the SpecBoard org. `--plan development`
# is the cheapest tier (displays as "basic"); MPG's minimum volume is 10 GB.
if fly mpg list --org "$ORG" --json | jq -e '.[] | select(.name=="palouse-staging-db")' >/dev/null 2>&1; then
  echo "    palouse-staging-db already exists — skipping create"
else
  fly mpg create --name palouse-staging-db --org "$ORG" --region "$REGION" \
    --plan development --pg-major-version 17 --volume-size 10
fi

# Attach the cluster to each backend app. `attach` injects DATABASE_URL as a
# secret on the app — so DATABASE_URL is NOT in .env.staging and fly-secrets.sh
# never pushes it. Web is excluded (no DB access; build-time env only).
MPG_ID="$(fly mpg list --org "$ORG" --json | jq -r '.[] | select(.name=="palouse-staging-db") | .id')"
for app in palouse-staging-api palouse-staging-worker palouse-staging-mcp; do
  if fly secrets list --app "$app" 2>/dev/null | grep -q 'DATABASE_URL'; then
    echo "    $app already has DATABASE_URL — skipping attach"
  else
    echo "    Attaching palouse-staging-db -> $app"
    fly mpg attach "$MPG_ID" --app "$app"
  fi
done

echo "==> Creating Upstash Redis (BullMQ needs eviction DISABLED — do not enable it)"
if fly redis list --json 2>/dev/null | grep -q '"palouse-staging-redis"'; then
  echo "    palouse-staging-redis already exists — skipping"
  echo "    Connection URL: fly redis status palouse-staging-redis"
else
  # Prints the rediss:// URL on success — copy it into .env.staging as REDIS_URL.
  # --enable-prodpack=false explicitly declines the $200/mo add-on so the
  # command runs non-interactively (otherwise it prompts).
  fly redis create --name palouse-staging-redis --org "$ORG" --region "$REGION" \
    --no-replicas --disable-eviction --enable-prodpack=false
fi

cat <<'EOF'

==> Next steps
  DATABASE_URL is already set on api/worker/mcp by `fly mpg attach` above —
  it is NOT in .env.staging.
  1. cp .env.staging.example .env.staging and fill in:
     - REDIS_URL     (printed above)
     - BETTER_AUTH_SECRET / PALOUSE_ENCRYPTION_KEY (openssl, commands in the file)
  2. ./scripts/fly-secrets.sh          # push secrets to api/worker/mcp
  3. ./scripts/fly-deploy.sh           # first deploy (api runs migrations)
  4. For CI deploys: fly tokens create org -o $FLY_ORG  -> save as FLY_API_TOKEN repo secret
EOF
