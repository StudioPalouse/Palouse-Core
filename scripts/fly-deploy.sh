#!/usr/bin/env bash
# Deploy all ReqOps staging apps from the local checkout.
# API deploys first because its release_command runs DB migrations.
#
# Usage: ./scripts/fly-deploy.sh [api|web|worker|mcp ...]   (default: all)
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ $# -gt 0 ]]; then TARGETS=("$@"); else TARGETS=(api web worker mcp); fi

deploy() {
  local name="$1"
  echo "==> Deploying $name"
  flyctl deploy . --config "fly/$name.toml" --dockerfile "apps/$name/Dockerfile" --remote-only --yes
}

for t in "${TARGETS[@]}"; do
  deploy "$t"
done

echo "==> Smoke check"
curl -fsS https://reqops-staging-api.fly.dev/health && echo " api /health OK" || echo " api /health FAILED"
