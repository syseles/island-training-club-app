#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration_name="20260921000002_declined_profile_decisions.sql"
migration="$repo_root/supabase/migrations/$migration_name"
historical="$repo_root/supabase/migrations/20260805000007_admin_application_decisions.sql"
historical_sha256="25e0bb33e29662fee1be3460af8ec7f1cc54b7b031ed02cd72b093c0b4bba4d1"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f "$migration" ]] || fail "missing forward migration: $migration"

version_count="$(find "$repo_root/supabase/migrations" -maxdepth 1 -type f \
  -name '20260921000002_*.sql' | wc -l | tr -d '[:space:]')"
[[ "$version_count" == "1" ]] || fail "migration version 20260921000002 must occur exactly once"

[[ -f "$historical" ]] || fail "missing protected historical migration"
actual_historical_sha256="$(shasum -a 256 "$historical" | awk '{print $1}')"
[[ "$actual_historical_sha256" == "$historical_sha256" ]] \
  || fail "historical migration 20260805000007 must remain byte-for-byte unchanged"

normalized="$(tr '\n' ' ' < "$migration" | tr -s '[:space:]' ' ')"
if ! grep -Eqi \
    "drop constraint if exists profiles_role_check;.*add constraint profiles_role_check check \\(role in \\('pending', 'member', 'admin', 'super_admin', 'declined'\\)\\);" \
    <<<"$normalized"; then
  fail "profiles_role_check must be safely recreated with exactly the five approved roles"
fi

approve_drop_line="$(grep -nF 'drop policy if exists "admin approve pending" on public.profiles;' "$migration" | cut -d: -f1 || true)"
decide_drop_line="$(grep -nF 'drop policy if exists "admin decide pending" on public.profiles;' "$migration" | cut -d: -f1 || true)"
decide_create_line="$(grep -nF 'create policy "admin decide pending"' "$migration" | cut -d: -f1 || true)"
[[ "$(wc -w <<<"$approve_drop_line" | tr -d '[:space:]')" == "1" ]] \
  || fail 'admin approve pending must be dropped exactly once'
[[ "$(wc -w <<<"$decide_drop_line" | tr -d '[:space:]')" == "1" ]] \
  || fail 'admin decide pending must be dropped exactly once'
[[ "$(wc -w <<<"$decide_create_line" | tr -d '[:space:]')" == "1" ]] \
  || fail 'admin decide pending must be created exactly once'
if (( approve_drop_line >= decide_create_line || decide_drop_line >= decide_create_line )); then
  fail "both possible policy names must be dropped before admin decide pending is created"
fi

policy_count="$(grep -Eic '^[[:space:]]*create policy ' "$migration" || true)"
[[ "$policy_count" == "1" ]] \
  || fail "the forward repair must create only the bounded admin decision policy"

policy_sql="$(awk '
  tolower($0) ~ /^create policy "admin decide pending"/ { capture = 1 }
  capture { print }
  capture && /;[[:space:]]*$/ { exit }
' "$migration")"
[[ -n "$policy_sql" ]] || fail "unable to extract admin decide pending policy"
normalized_policy="$(tr '\n' ' ' <<<"$policy_sql" | tr -s '[:space:]' ' ')"
using_sql="$(awk '
  tolower($0) ~ /^[[:space:]]*using[[:space:]]*\(/ { capture = 1 }
  tolower($0) ~ /^[[:space:]]*with check[[:space:]]*\(/ { capture = 0 }
  capture { print }
' <<<"$policy_sql")"
with_check_sql="$(awk '
  tolower($0) ~ /^[[:space:]]*with check[[:space:]]*\(/ { capture = 1 }
  capture { print }
' <<<"$policy_sql")"
[[ -n "$using_sql" ]] || fail "unable to extract admin decide pending USING clause"
[[ -n "$with_check_sql" ]] || fail "unable to extract admin decide pending WITH CHECK clause"
normalized_using="$(tr '\n' ' ' <<<"$using_sql" | tr -s '[:space:]' ' ')"
normalized_with_check="$(tr '\n' ' ' <<<"$with_check_sql" | tr -s '[:space:]' ' ')"
admin_predicate="coalesce\\( auth\\.jwt\\(\\) -> 'app_metadata' ->> 'role', public\\.current_user_role\\(\\) \\) = 'admin'"

for pattern in \
  "$admin_predicate" \
  "and role = 'pending'"; do
  if ! grep -Eqi "$pattern" <<<"$normalized_using"; then
    fail "admin decision USING clause missing required boundary: $pattern"
  fi
done

for pattern in \
  "$admin_predicate" \
  'and id <> auth\.uid\(\)' \
  "role in \\('member', 'declined'\\)" \
  'exists \(' \
  'from public\.applications as submitted_application' \
  'submitted_application\.profile_id = public\.profiles\.id' \
  'submitted_application\.submitted_at is not null'; do
  if ! grep -Eqi "$pattern" <<<"$normalized_with_check"; then
    fail "admin decision WITH CHECK clause missing required boundary: $pattern"
  fi
done

if ! grep -Eqi 'on public\.profiles for update' <<<"$normalized_policy"; then
  fail "admin decision policy must be an UPDATE policy on public.profiles"
fi

if grep -Eqi \
    'grant[[:space:]]+[^;]*update[^;]*on[[:space:]]+(table[[:space:]]+)?public\.profiles[^;]*to[^;]*authenticated' \
    <<<"$normalized"; then
  fail "authenticated must not receive a broad direct profiles UPDATE grant"
fi

if grep -Eqi 'using[[:space:]]*\([[:space:]]*(true|auth\.role\(\)[[:space:]]*=[[:space:]]*'"'"'authenticated'"'"')' \
    <<<"$normalized_policy"; then
  fail "authenticated must not receive a broad profiles UPDATE policy"
fi

echo "ok  declined profile decision forward migration safety"
