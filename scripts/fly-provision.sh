#!/usr/bin/env bash
# One-time provisioning of the ReqOps staging environment on Fly.io.
# Idempotent: safe to re-run; existing apps are skipped.
#
# Prereqs: `fly auth login` done; FLY_ORG (default: reqops).
set -euo pipefail

ORG="${FLY_ORG:-reqops}"
REGION="${FLY_REGION:-iad}"
APPS=(reqops-staging-api reqops-staging-web reqops-staging-worker reqops-staging-mcp)

echo "==> Creating Fly apps in org '$ORG'"
for app in "${APPS[@]}"; do
  if fly apps list --org "$ORG" --json | grep -q "\"$app\""; then
    echo "    $app already exists — skipping"
  else
    fly apps create "$app" --org "$ORG"
  fi
done

echo "==> Creating Upstash Redis (BullMQ needs eviction DISABLED — do not enable it)"
if fly redis list --json 2>/dev/null | grep -q '"reqops-staging-redis"'; then
  echo "    reqops-staging-redis already exists — skipping"
  echo "    Connection URL: fly redis status reqops-staging-redis"
else
  # Prints the rediss:// URL on success — copy it into .env.staging as REDIS_URL.
  fly redis create --name reqops-staging-redis --org "$ORG" --region "$REGION" \
    --no-replicas --disable-eviction --enable-prodpack=false
fi

cat <<'EOF'

==> Next steps
  1. cp .env.staging.example .env.staging and fill in:
     - DATABASE_URL  (Supabase reqops-staging password: dashboard -> Project Settings -> Database)
     - REDIS_URL     (printed above)
     - BETTER_AUTH_SECRET / REQOPS_ENCRYPTION_KEY (openssl, commands in the file)
  2. ./scripts/fly-secrets.sh          # push secrets to api/worker/mcp
  3. ./scripts/fly-deploy.sh           # first deploy (api runs migrations)
  4. For CI deploys: fly tokens create org -o $FLY_ORG  -> save as FLY_API_TOKEN repo secret
EOF
