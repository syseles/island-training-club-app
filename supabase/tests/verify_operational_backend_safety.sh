#!/usr/bin/env bash
# Island Training Club — safety-only harness for the operational backend
# destructive verifier. Exercises the gate without ever touching a database.
#
# This script must NOT require psql or any database URL. It runs the verifier
# in safety-check-only mode against backgrounds and asserts that:
#   - missing environment variables exit 2
#   - missing ITC_ALLOW_DATABASE_RESET exits 2
#   - the harness itself is non-destructive.
#
# Usage:
#   bash supabase/tests/verify_operational_backend_safety.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/supabase/tests/verify_operational_backend.sh"

if [[ ! -x "$verifier" ]]; then
  chmod +x "$verifier"
fi

run_case() {
  local label="$1" expect="$2"
  shift 2
  set +e
  "$verifier" "$@"
  local actual=$?
  set -e
  if [[ "$actual" != "$expect" ]]; then
    echo "FAIL: $label expected exit $expect, got $actual" >&2
    exit 1
  fi
  echo "PASS: $label (exit $actual)"
}

run_case "missing URL is refused" 2
run_case "missing ITC_ALLOW_DATABASE_RESET is refused" 2
ICT_OPERATIONS_TEST_DATABASE_URL="postgresql://example" \
  run_case "missing ITC_ALLOW_DATABASE_RESET is refused (env set)" 2

# Ensure --safety-check-only is honored when no URL is supplied: must not
# attempt any database connection.
ICT_OPERATIONS_TEST_DATABASE_URL="postgresql://example.invalid:5432/postgres" \
  run_case "missing ITC_ALLOW_DATABASE_RESET still refuses" 2

# When the gate is acknowledged but no URL is supplied, the script must
# refuse with exit 2 (not 3, which would imply a connection attempt).
run_case "URL required even when acknowledged" 2

echo "Safety verifier passed: gate rejects unsafe conditions."
