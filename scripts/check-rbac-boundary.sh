#!/bin/bash
# Enforce the RBAC authorization boundary (DES-445 slice 1).
#
# All authorization DECISIONS in API-side code must go through `can()` from
# src/rbac/ — no inline `isLead` authz conditionals in src/tools/ or src/http/.
# The Phase-1 gate inventory (plan 2026-07-07-des-445-rbac-slice1-can-audit.md,
# Appendix A) migrated every HARD gate; this check keeps them migrated and
# fails any NEW inline `isLead` authz check with a pointer to src/rbac.
#
# HONEST LIMITS of this check:
#   - It enforces "no inline isLead authz conditional", NOT "every new tool
#     calls can()". A tool added without any permission check passes silently.
#     Enforcement-by-construction (a required `permissions` field on
#     ToolConfig / route()) is increment 5 of DES-445.
#   - Lines where `isLead` appears only as an object/type PROPERTY KEY are
#     allowed wholesale (principal construction feeding can(), zod schemas,
#     createAgent registration pass-through, memory visibility pins).
#
# Allowed `isLead` usage (everything else is a violation):
#   1. Property-key / shorthand-property lines (see above).
#   2. SOFT memory read-visibility scoping — memory RBAC parallel track:
#        src/tools/memory-search.ts
#   3. NON-AUTHZ sites (Appendix A):
#        src/tools/slack-reply.ts   — cosmetic icon_emoji pick
#        src/tools/join-swarm.ts    — registration-time lead assignment
#                                     (increment-4 hardening surface)
#        src/tools/send-task.ts     — target-shape guard (task TO lead)
#        src/http/poll.ts           — lead-vs-worker trigger routing
#   4. Principal-construction plumbing:
#        src/http/kv.ts             — buildAuthCtx isLead local feeding can()

set -euo pipefail

CHECK_PATHS=(
  src/tools
  src/http
)

# Files where bare `.isLead` reads / `isLead` identifiers are allowed
# (SOFT scoping, NON-AUTHZ, principal-construction plumbing — see header).
ALLOWED_FILES=(
  "src/tools/memory-search.ts"
  "src/tools/slack-reply.ts"
  "src/tools/join-swarm.ts"
  "src/tools/send-task.ts"
  "src/http/poll.ts"
  "src/http/kv.ts"
)

HITS=$(grep -rn --include='*.ts' --include='*.tsx' 'isLead' "${CHECK_PATHS[@]}" 2>/dev/null || true)

# Allow lines where isLead is used as a property key (`isLead:` / `isLead?:`)
# or a shorthand object property (`isLead,` / `isLead }`) — construction, not
# a decision. Member accesses like `agent.isLead` in a conditional never match
# either pattern (they are preceded by `.` / followed by `)` or `;`).
FILTERED=$(echo "$HITS" \
  | grep -vE '(^|[^.?[:alnum:]])isLead\??[[:space:]]*:' \
  | grep -vE '[^.?[:alnum:]]isLead[[:space:]]*[,}]' \
  || true)

VIOLATIONS=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  file="${line%%:*}"
  allowed=false
  for allowed_file in "${ALLOWED_FILES[@]}"; do
    if [ "$file" = "$allowed_file" ]; then
      allowed=true
      break
    fi
  done
  if [ "$allowed" = false ]; then
    VIOLATIONS="${VIOLATIONS}${line}\n"
  fi
done <<< "$FILTERED"

if [ -n "$VIOLATIONS" ]; then
  echo "ERROR: RBAC authorization boundary violation detected!"
  echo ""
  echo "Authorization decisions in src/tools/ and src/http/ must go through"
  echo "can() from src/rbac/ — inline isLead authz checks are not allowed."
  echo ""
  echo "Violations:"
  echo -e "$VIOLATIONS"
  echo ""
  echo "Fix: build an RbacPrincipal and call can({principal, verb, resource, source})"
  echo "(see src/tools/kv/kv-write-auth.ts for the pattern). If this is a genuinely"
  echo "non-authorization use of isLead, add the file to ALLOWED_FILES in"
  echo "scripts/check-rbac-boundary.sh with a one-line reason in the header."
  exit 1
fi

echo "RBAC authorization boundary check passed."
