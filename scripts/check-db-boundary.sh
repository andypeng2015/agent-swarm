#!/bin/bash
# Enforce the Worker/API DB boundary invariant.
#
# The API server is the sole owner of the SQLite database. Worker-side code
# must NEVER import database modules directly — workers communicate with the
# API exclusively via HTTP.
#
# DB owner paths:
#   packages/storage/  packages/workflows/
#
# Worker-side paths:
#   apps/cli/src/  src/hooks/  src/prompts/  src/cli.tsx
#   packages/{types,core-utils,otel,ai-pricing,credentials,prompt-templates,artifacts,scripts,
#             api-client,e2b-dispatch,swarm-templates,ai-llm,mcp-tool,harness}/
#   plugin/opencode-plugins/  (runs inside the opencode subprocess in the worker)
#
# Forbidden patterns:
#   - static import/from @swarm/storage, @swarm/workflows, or legacy be/db
#   - import/from bun:sqlite (raw SQLite driver)

set -euo pipefail

WORKER_PATHS=(
  apps/cli/src/
  src/hooks/
  src/prompts/
  src/utils/
  packages/types/
  packages/core-utils/
  packages/otel/
  packages/ai-pricing/
  packages/credentials/
  packages/prompt-templates/
  packages/artifacts/
  packages/scripts/
  packages/api-client/
  packages/e2b-dispatch/
  packages/swarm-templates/
  packages/ai-llm/
  packages/mcp-tool/
  packages/harness/
  src/cli.tsx
  plugin/opencode-plugins/
)

VIOLATIONS=""

for path in "${WORKER_PATHS[@]}"; do
  if [ ! -e "$path" ]; then
    continue
  fi

  # Check for static imports from DB-owning packages or legacy be/db paths.
  MATCHES=$(grep -rn --include='*.ts' --include='*.tsx' \
    -E '(from\s+["\x27](@swarm/(storage|workflows)|.*be/db)|import\s+["\x27]@swarm/(storage|workflows))' \
    "$path" 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    VIOLATIONS="${VIOLATIONS}${MATCHES}\n"
  fi

  # Check for bun:sqlite imports
  MATCHES=$(grep -rn --include='*.ts' --include='*.tsx' -E '(import|from)\s+["\x27]bun:sqlite' "$path" 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    VIOLATIONS="${VIOLATIONS}${MATCHES}\n"
  fi
done

if [ -n "$VIOLATIONS" ]; then
  echo "ERROR: Worker/API DB boundary violation detected!"
  echo ""
  echo "Worker-side code must NOT import database modules."
  echo "Workers communicate with the API via HTTP — they never access the DB directly."
  echo ""
  echo "Violations:"
  echo -e "$VIOLATIONS"
  echo ""
  echo "Fix: Move DB-dependent logic to packages/storage/, packages/workflows/, src/http/, or src/tools/ (API-side),"
  echo "or extract pure functions to a shared package (e.g., @swarm/core-utils)."
  exit 1
fi

echo "Worker/API DB boundary check passed."
