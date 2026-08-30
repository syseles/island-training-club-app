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
concurrency="$repo_root/supabase/tests/operational_rsvp_concurrency.sh"

if [[ ! -x "$verifier" ]]; then
  chmod +x "$verifier"
fi
if [[ ! -x "$concurrency" ]]; then
  echo "FAIL: bounded RSVP concurrency harness is missing or not executable" >&2
  exit 1
fi
bash -n "$concurrency"
if ! grep -Fq 'operational_rsvp_concurrency.sh' "$verifier"; then
  echo "FAIL: operational verifier does not invoke the RSVP concurrency harness" >&2
  exit 1
fi

# Source contracts protect fixture validity even when PostgreSQL is unavailable.
# They intentionally validate the harness boundary that the schema enforces:
# event-* template IDs, activity-date session IDs, and rollback-safe cleanup.
python3 - "$concurrency" <<'PY'
import re
import sys
from pathlib import Path

source = Path(sys.argv[1]).read_text()

def fail(message):
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)

def assignment(name):
    match = re.search(rf'^{re.escape(name)}="([^"]+)"$', source, re.MULTILINE)
    if not match:
        fail(f"concurrency harness is missing {name}")
    return match.group(1)

for name in ("paid_activity", "rsvp_activity"):
    if not assignment(name).startswith("event-"):
        fail(f"{name} must use a schema-valid event-* ID")

expected_sessions = {
    "paid_session": "${paid_activity}-${paid_date}",
    "rsvp_session_a": "${rsvp_activity}-${rsvp_date_a}",
    "rsvp_session_b": "${rsvp_activity}-${rsvp_date_b}",
}
for name, expected in expected_sessions.items():
    if assignment(name) != expected:
        fail(f"{name} must be derived as activity_id-session_date")

for name in ("paid_date", "rsvp_date_a", "rsvp_date_b"):
    if not re.search(rf"\b{re.escape(name)}\b", source):
        fail(f"concurrency harness is missing dynamic date {name}")
if "Asia/Hong_Kong" not in source:
    fail("concurrency fixture dates must be derived dynamically in HKT")

try:
    cleanup = source.split("cleanup() {", 1)[1].split("trap cleanup EXIT", 1)[0]
except IndexError:
    fail("concurrency harness is missing EXIT cleanup")
for contract in ('local original_status=$?', 'exit "$original_status"'):
    if contract not in cleanup:
        fail("cleanup must preserve the harness original exit status")

cleanup_steps = [
    "delete from public.operational_bookings",
    "delete from public.operational_sessions",
    "delete from public.operational_activity_templates",
    "delete from auth.users",
]
positions = []
for step in cleanup_steps:
    position = cleanup.find(step)
    if position < 0:
        fail(f"cleanup is missing child-first step: {step}")
    positions.append(position)
if positions != sorted(positions):
    fail("cleanup must delete bookings before sessions, templates, and users")

print("PASS: concurrency source contracts enforce schema-valid fixtures and child-first cleanup")
PY

run_case() {
  local label="$1" expect="$2" command="$3"
  shift 3
  set +e
  "$command" "$@"
  local actual=$?
  set -e
  if [[ "$actual" != "$expect" ]]; then
    echo "FAIL: $label expected exit $expect, got $actual" >&2
    exit 1
  fi
  echo "PASS: $label (exit $actual)"
}

run_case "missing URL is refused" 2 "$verifier"
ITC_OPERATIONS_TEST_DATABASE_URL="postgresql://example" \
  run_case "missing ITC_ALLOW_DATABASE_RESET is refused (env set)" 2 "$verifier"

# Ensure --safety-check-only is honored when no URL is supplied: must not
# attempt any database connection.
ITC_OPERATIONS_TEST_DATABASE_URL="postgresql://example.invalid:5432/postgres" \
  run_case "missing ITC_ALLOW_DATABASE_RESET still refuses" 2 "$verifier"

# When the gate is acknowledged but no URL is supplied, the script must
# refuse with exit 2 (not 3, which would imply a connection attempt).
ITC_ALLOW_DATABASE_RESET=1 run_case "URL required even when acknowledged" 2 "$verifier"

run_case "concurrency harness refuses missing URL" 2 "$concurrency"
ITC_OPERATIONS_TEST_DATABASE_URL="postgresql://example" \
  run_case "concurrency harness refuses missing acknowledgment" 2 "$concurrency"
ITC_ALLOW_DATABASE_RESET=1 \
  run_case "concurrency harness requires a URL when acknowledged" 2 "$concurrency"

# Acknowledged source-only mode must parse and exit without touching psql.
fake_dir="$(mktemp -d)"
trap 'rm -rf "$fake_dir"' EXIT
cat >"$fake_dir/psql" <<'EOF'
#!/usr/bin/env bash
touch "${ITC_FAKE_PSQL_CALLED:?}"
exit 99
EOF
chmod +x "$fake_dir/psql"
ITC_FAKE_PSQL_CALLED="$fake_dir/called" \
ITC_OPERATIONS_PSQL_BIN="$fake_dir/psql" \
ITC_OPERATIONS_TEST_DATABASE_URL="postgresql://source-only.invalid/postgres" \
ITC_ALLOW_DATABASE_RESET=1 \
  run_case "concurrency source safety mode is non-destructive" 0 "$concurrency" --safety-check-only
if [[ -e "$fake_dir/called" ]]; then
  echo "FAIL: concurrency source safety mode invoked psql" >&2
  exit 1
fi

echo "Safety verifier passed: gates reject unsafe conditions and validate bounded concurrency wiring."
