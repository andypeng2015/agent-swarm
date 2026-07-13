#!/usr/bin/env bash
# Operations-triage matrix cell driver. Example: MODE=scripts PROVIDER=claude ./matrix-drive3.sh
set -euo pipefail

cd "$(dirname "$0")/../../../.."
set -a; source .env.docker; set +a

MODE="${MODE:-${1:-}}"
PROVIDER="${PROVIDER:-${2:-}}"
RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
SEEDS="${SEEDS:-seeds}"

if [[ "$MODE" != "scripts" && "$MODE" != "full" ]]; then
  echo "MODE must be scripts or full" >&2
  exit 2
fi
if [[ "$PROVIDER" != "claude" && "$PROVIDER" != "codex" ]]; then
  echo "PROVIDER must be claude or codex" >&2
  exit 2
fi
if [[ "$PROVIDER" == "codex" && -z "${CODEX_OAUTH:-}" ]]; then
  echo "CODEX_OAUTH is required for codex matrix cells" >&2
  exit 1
fi

if [[ "$MODE" == "scripts" ]]; then
  export SCRIPTS_ONLY_MCP=true
  MATRIX_MODE="scripts-only"
else
  export SCRIPTS_ONLY_MCP=""
  MATRIX_MODE="full"
fi

bun thoughts/shared/research/matrix-tools/matrix-run.ts "$MATRIX_MODE" "$RUN_ID" "$PROVIDER" "$SEEDS" --scenario triage
