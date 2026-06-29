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

echo "==> Creating Fly Postgres (single node — staging stays on the minimal footprint)"
if fly apps list --org "$ORG" --json | grep -q '"palouse-staging-db"'; then
  echo "    palouse-staging-db already exists — skipping"
else
  fly postgres create --name palouse-staging-db --org "$ORG" --region "$REGION" \
    --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1
  cat <<'PGEOF'
    Now create the app role and database (password goes into .env.staging):
      fly postgres connect -a palouse-staging-db
      CREATE ROLE palouse_app LOGIN PASSWORD '<openssl rand -hex 24>';
      CREATE DATABASE palouse OWNER palouse_app;
PGEOF
fi

echo "==> Creating Upstash Redis (BullMQ needs eviction DISABLED — do not enable it)"
if fly redis list --json 2>/dev/null | grep -q '"palouse-staging-redis"'; then
  echo "    palouse-staging-redis already exists — skipping"
  echo "    Connection URL: fly redis status palouse-staging-redis"
else
  # Prints the rediss:// URL on success — copy it into .env.staging as REDIS_URL.
  fly redis create --name palouse-staging-redis --org "$ORG" --region "$REGION" \
    --no-replicas --disable-eviction --enable-prodpack=false
fi

cat <<'EOF'

==> Next steps
  1. cp .env.staging.example .env.staging and fill in:
     - DATABASE_URL  (palouse_app password chosen at CREATE ROLE above)
     - REDIS_URL     (printed above)
     - BETTER_AUTH_SECRET / PALOUSE_ENCRYPTION_KEY (openssl, commands in the file)
  2. ./scripts/fly-secrets.sh          # push secrets to api/worker/mcp
  3. ./scripts/fly-deploy.sh           # first deploy (api runs migrations)
  4. For CI deploys: fly tokens create org -o $FLY_ORG  -> save as FLY_API_TOKEN repo secret
EOF
