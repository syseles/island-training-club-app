#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/supabase/migrations/20260921000001_prayer_requests.sql"

if [[ ! -f "$migration" ]]; then
  echo "FAIL: missing migration: $migration" >&2
  exit 1
fi

grep -qi 'enable row level security' "$migration"
grep -qi 'revoke all on table public.prayer_requests from public, anon, authenticated' "$migration"

extract_function() {
  local fn="$1"
  awk -v fn="$fn" '
    BEGIN { pattern = "^create (or replace )?function public\\." fn "\\(" }
    tolower($0) ~ pattern { capture = 1 }
    capture { print }
    capture && /^\$\$;$/ { exit }
  ' "$migration"
}

for fn in \
  submit_prayer_request \
  list_my_prayer_requests \
  set_my_prayer_request_state \
  list_admin_prayer_requests \
  set_admin_prayer_request_status; do
  function_sql="$(extract_function "$fn")"
  if [[ -z "$function_sql" ]] || ! grep -qi 'security definer' <<<"$function_sql"; then
    echo "FAIL: $fn must be a bounded security-definer function" >&2
    exit 1
  fi
  grep -qi "revoke all on function public.$fn" "$migration"
done

if grep -Eqi 'grant (select|insert|update|delete).*prayer_requests.*authenticated' "$migration"; then
  echo 'FAIL: authenticated must not receive direct prayer_requests table access' >&2
  exit 1
fi

admin_result="$(awk '
  tolower($0) ~ /^create (or replace )?function public\.list_admin_prayer_requests\(/ {
    capture = 1
  }
  capture { print }
  capture && tolower($0) ~ /^language / { exit }
' "$migration")"
if [[ -z "$admin_result" ]] || grep -Eqi '\b(owner_id|email)\b' <<<"$admin_result"; then
  echo 'FAIL: list_admin_prayer_requests must not return owner_id or email' >&2
  exit 1
fi

echo 'prayer-request migration safety passed'
