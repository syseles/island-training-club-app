#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required (PostgreSQL client)." >&2
  exit 2
fi
if [[ -z "${ITC_NOTIFICATION_TEST_DATABASE_URL:-}" ]]; then
  echo "ERROR: set ITC_NOTIFICATION_TEST_DATABASE_URL to a disposable, empty Supabase-compatible database." >&2
  exit 2
fi
if [[ "${ITC_ALLOW_DATABASE_RESET:-}" != "1" ]]; then
  echo "ERROR: set ITC_ALLOW_DATABASE_RESET=1 to confirm the target is disposable." >&2
  exit 2
fi

psql_cmd=(psql "${ITC_NOTIFICATION_TEST_DATABASE_URL}" -X -v ON_ERROR_STOP=1)

# Refuse to run against an initialized project: this verifier applies every
# migration and must never modify a shared or production database.
if [[ "$("${psql_cmd[@]}" -Atqc "select to_regclass('public.profiles') is null")" != "t" ]]; then
  echo "ERROR: public.profiles already exists; use a fresh disposable database." >&2
  exit 3
fi
for required in auth.users auth.uid anon authenticated; do
  case "$required" in
    auth.users) check="select to_regclass('auth.users') is not null" ;;
    auth.uid) check="select to_regprocedure('auth.uid()') is not null" ;;
    *) check="select exists (select 1 from pg_roles where rolname = '$required')" ;;
  esac
  if [[ "$("${psql_cmd[@]}" -Atqc "$check")" != "t" ]]; then
    echo "ERROR: target is not Supabase-compatible; missing $required." >&2
    exit 3
  fi
done

for migration in "$repo_root"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$migration")"
  "${psql_cmd[@]}" -f "$migration"
done

echo "Running notification trigger, audit, fan-out, privilege, and RLS checks"
"${psql_cmd[@]}" -f "$repo_root/supabase/tests/admin_notifications_integration.sql"
