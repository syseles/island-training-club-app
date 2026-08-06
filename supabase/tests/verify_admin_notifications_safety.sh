#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/supabase/tests/verify_admin_notifications.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/itc-notification-safety.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

cat >"$tmp_dir/psql" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
query="${*: -1}"
scenario="${ITC_SAFETY_TEST_SCENARIO:-safe}"

case "$query" in
  *"to_regclass('public.profiles') is null"*)
    [[ "$scenario" == "profiles" ]] && printf 'f\n' || printf 't\n'
    ;;
  *"to_regclass('auth.users') is not null"*|*"to_regprocedure('auth.uid()') is not null"*|*"from pg_roles"*)
    printf 't\n'
    ;;
  *"count(*) from auth.users"*)
    [[ "$scenario" == "users" ]] && printf '1\n' || printf '0\n'
    ;;
  *"unexpected_public_objects"*|*"from pg_class c"*)
    [[ "$scenario" == "objects" ]] && printf '2\n' || printf '0\n'
    ;;
  *)
    printf 'mock psql received an unexpected query: %s\n' "$query" >&2
    exit 99
    ;;
esac
EOF
chmod +x "$tmp_dir/psql"

run_case() {
  local name="$1" scenario="$2" acknowledgement="$3" expected_status="$4" expected_text="$5"
  local output status
  set +e
  output="$(ITC_SAFETY_TEST_SCENARIO="$scenario" \
    ITC_NOTIFICATION_PSQL_BIN="$tmp_dir/psql" \
    ITC_NOTIFICATION_TEST_DATABASE_URL='postgresql://verifier-owned.invalid/postgres' \
    ITC_ALLOW_DATABASE_RESET="$acknowledgement" \
    "$verifier" --safety-check-only 2>&1)"
  status=$?
  set -e
  if [[ "$status" != "$expected_status" || "$output" != *"$expected_text"* ]]; then
    printf 'FAIL: %s (status %s)\n%s\n' "$name" "$status" "$output" >&2
    exit 1
  fi
  printf 'PASS: %s\n' "$name"
}

run_case 'safe empty target is accepted' safe 1 0 'Safety gate passed'
run_case 'explicit acknowledgement is required' safe 0 2 'ITC_ALLOW_DATABASE_RESET=1'
run_case 'existing profiles are rejected' profiles 1 3 'public.profiles already exists'
run_case 'existing auth users are rejected' users 1 3 'auth.users is not empty'
run_case 'unexpected public objects are rejected' objects 1 3 'unexpected user object(s)'

echo 'Admin notification verifier safety checks passed.'
