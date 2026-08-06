#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
psql_bin="${ITC_GIVING_PSQL_BIN:-psql}"

if ! command -v "$psql_bin" >/dev/null 2>&1; then
  echo "ERROR: psql is required (PostgreSQL client)." >&2
  exit 2
fi
if [[ -z "${ITC_GIVING_TEST_DATABASE_URL:-}" ]]; then
  echo "ERROR: set ITC_GIVING_TEST_DATABASE_URL to a disposable, empty Supabase-compatible database." >&2
  exit 2
fi
if [[ "${ITC_ALLOW_DATABASE_RESET:-}" != "1" ]]; then
  echo "ERROR: set ITC_ALLOW_DATABASE_RESET=1 to confirm the target is disposable." >&2
  exit 2
fi

psql_cmd=("$psql_bin" "${ITC_GIVING_TEST_DATABASE_URL}" -X -v ON_ERROR_STOP=1)

# Destructive migration verification is admitted only for an acknowledged,
# unused Supabase database. Check both baseline compatibility and freshness.
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
if [[ "$("${psql_cmd[@]}" -Atqc "select count(*) from auth.users")" != "0" ]]; then
  echo "ERROR: auth.users is not empty; refusing to modify a used database." >&2
  exit 3
fi

unexpected_public_objects="$("${psql_cmd[@]}" -Atqc "
  select count(*) from (
    select c.oid
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_class'::regclass
            and d.objid = c.oid and d.deptype = 'e'
       )
    union all
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_proc'::regclass
            and d.objid = p.oid and d.deptype = 'e'
       )
    union all
    select t.oid
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typrelid = 0
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_type'::regclass
            and d.objid = t.oid and d.deptype = 'e'
       )
  ) unexpected
")"
if [[ "$unexpected_public_objects" != "0" ]]; then
  echo "ERROR: public contains $unexpected_public_objects unexpected user object(s); use an empty disposable database." >&2
  exit 3
fi

echo "Safety gate passed: acknowledged disposable target; auth.users and public user objects are empty."
if [[ "${1:-}" == "--safety-check-only" ]]; then
  exit 0
fi
if [[ $# -gt 0 ]]; then
  echo "ERROR: unknown argument: $1" >&2
  exit 2
fi

for migration in "$repo_root"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$migration")"
  "${psql_cmd[@]}" -f "$migration"
done

echo "Running preserved Admin notification integration checks"
"${psql_cmd[@]}" -f "$repo_root/supabase/tests/admin_notifications_integration.sql"
echo "Running Giving audience fan-out, duplicate suppression, one-open invariant, closed immutability, member RLS, and pending RLS checks"
"${psql_cmd[@]}" -f "$repo_root/supabase/tests/giving_campaigns_integration.sql"
