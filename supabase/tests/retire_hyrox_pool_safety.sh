#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/20260922000001_retire_bft_midtown_hyrox_pool.sql"

fail() {
  printf 'retired HYROX pool migration safety failed: %s\n' "$1" >&2
  return 1
}

top_level_sql() {
  awk '
    {
      lower = tolower($0)
      if (!in_function_body && lower ~ /^[[:space:]]*create([[:space:]]+or[[:space:]]+replace)?[[:space:]]+function[[:space:]]/) {
        in_function_declaration = 1
      }
      if (!in_function_body) print
      markers = gsub(/\$\$/, "&")
      if (in_function_declaration && !in_function_body && markers % 2 == 1) {
        in_function_body = 1
      } else if (in_function_body && markers % 2 == 1) {
        in_function_body = 0
        in_function_declaration = 0
      }
    }
  ' "$1"
}

check_forbidden_statements() {
  local source="$1"
  local top_level
  top_level="$(top_level_sql "$source")"

  if grep -Eiq '\b(delete[[:space:]]+from|truncate([[:space:]]+table)?)\b[^;]*(operational_hyrox|operational_bookings|operational_receipts|notifications)' "$source"; then
    fail "destructive retained-domain statement found in $source"
    return 1
  fi
  if grep -Eiq 'insert[[:space:]]+into[[:space:]]+public\.notifications' <<<"$top_level"; then
    fail "deployment-time notification insert found in $source"
    return 1
  fi
  if grep -Eiq '(^|[;[:space:]])(select|perform|call)[[:space:]]+(public\.)?cancel_hyrox_cycle[[:space:]]*\(' <<<"$top_level"; then
    fail "deployment-time pool cancellation invocation found in $source"
    return 1
  fi
}

test -f "$MIGRATION" || fail "retirement migration is missing"
for marker in \
  "hyrox-bft" \
  "hyrox-midtown" \
  "hyrox-quarry-bay" \
  "operational_is_retired_hyrox_activity" \
  "operational_is_retired_hyrox_session" \
  "operational_is_retired_hyrox_booking" \
  "revoke execute"
do
  grep -Fq "$marker" "$MIGRATION" || fail "required marker is missing: $marker"
done
if ! grep -Eq 'grant execute on function public\.operational_is_retired_hyrox_session\(text\)' "$MIGRATION"; then
  fail "service-role avatar classifier grant is missing"
fi
if ! grep -Eq '^[[:space:]]*to service_role;' "$MIGRATION"; then
  fail "service-role avatar classifier grantee is missing"
fi
check_forbidden_statements "$MIGRATION"

# Adversarial self-tests prove forbidden matches fail while ACL-only references
# to the retired cancellation function remain valid.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
printf '%s\n' \
  'revoke execute on function public.cancel_hyrox_cycle(text, text) from authenticated;' \
  > "$TMP_DIR/allowed-revoke.sql"
check_forbidden_statements "$TMP_DIR/allowed-revoke.sql"

printf '%s\n' 'delete from public.operational_bookings where true;' \
  > "$TMP_DIR/destructive.sql"
if check_forbidden_statements "$TMP_DIR/destructive.sql" >/dev/null 2>&1; then
  fail "self-test accepted a destructive retained-domain statement"
fi

printf '%s\n' \
  "insert into public.notifications (profile_id, kind, title, body) values (gen_random_uuid(), 'x', 'x', 'x');" \
  > "$TMP_DIR/notification.sql"
if check_forbidden_statements "$TMP_DIR/notification.sql" >/dev/null 2>&1; then
  fail "self-test accepted a deployment-time notification insert"
fi

cat > "$TMP_DIR/notification-do.sql" <<'SQL'
do $$
begin
  insert into public.notifications (profile_id, kind, title, body)
  values (gen_random_uuid(), 'x', 'x', 'x');
end;
$$;
SQL
if check_forbidden_statements "$TMP_DIR/notification-do.sql" >/dev/null 2>&1; then
  fail "self-test accepted a notification insert inside an executed DO block"
fi

printf '%s\n' "select public.cancel_hyrox_cycle('hyrox-pool-2099-01-03', 'x');" \
  > "$TMP_DIR/cancellation.sql"
if check_forbidden_statements "$TMP_DIR/cancellation.sql" >/dev/null 2>&1; then
  fail "self-test accepted a deployment-time cancellation invocation"
fi

python3 "$ROOT/supabase/tests/verify_retired_hyrox_correction.py"
echo "retired HYROX pool migration safety passed"
