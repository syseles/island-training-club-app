#!/usr/bin/env bash
# Safety-only contract for the destructive profile-avatar verifier.
# The verifier must reject missing acknowledgment before invoking psql.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/supabase/tests/verify_profile_avatars.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
psql_log="$tmp_dir/psql-called"

cat >"$tmp_dir/psql" <<EOF
#!/usr/bin/env bash
touch "$psql_log"
exit 99
EOF
chmod +x "$tmp_dir/psql"

run_refusal_case() {
  local label="$1"
  shift
  rm -f "$psql_log"
  set +e
  env -i PATH="$tmp_dir:/usr/bin:/bin" HOME="${HOME:-/tmp}" "$@" bash "$verifier" >/dev/null 2>&1
  local actual=$?
  set -e
  if [[ "$actual" != "2" ]]; then
    echo "FAIL: $label expected exit 2, got $actual" >&2
    exit 1
  fi
  if [[ -e "$psql_log" ]]; then
    echo "FAIL: $label invoked psql before passing the safety gate" >&2
    exit 1
  fi
  echo "PASS: $label"
}

run_refusal_case "missing URL and acknowledgment"
run_refusal_case "missing acknowledgment" \
  ITC_AVATAR_TEST_DATABASE_URL="postgresql://example.invalid/postgres"
run_refusal_case "missing URL" \
  ITC_ALLOW_DATABASE_RESET=1

echo "Profile-avatar safety verifier passed."
