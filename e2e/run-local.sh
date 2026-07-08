#!/usr/bin/env bash
#
# Run E2E tests locally using act (https://github.com/nektos/act)
#
# The GitHub workflow (.github/workflows/e2e.yml) is the single source
# of truth. This script just invokes it locally via act.
#
# Install act:
#   brew install act
#   # or: gh extension install https://github.com/nektos/gh-act
#
# Usage:
#   bash e2e/run-local.sh          # Run the full E2E job
#   pnpm test:e2e-local             # Same thing via package.json
#
set -euo pipefail

if ! command -v act &>/dev/null; then
  echo "Error: 'act' is not installed."
  echo ""
  echo "Install via one of:"
  echo "  brew install act"
  echo "  gh extension install https://github.com/nektos/gh-act"
  echo ""
  echo "See https://github.com/nektos/act for more options."
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

mkdir -p "$REPO_ROOT/e2e/artifacts"

exec act -j e2e \
  -W .github/workflows/e2e.yaml \
  --artifact-server-path "$REPO_ROOT/e2e/artifacts" \
  --container-daemon-socket /var/run/docker.sock \
  --container-architecture linux/amd64 \
  "$@"
