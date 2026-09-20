#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/supabase/migrations/20260920000001_free_event_rsvp_cancellation.sql"

if [[ ! -f "$migration" ]]; then
  echo "FAIL: missing migration: $migration" >&2
  exit 1
fi

rg -q "'wnt'.*'run'.*'water'|activity_id in .*wnt" "$migration"
rg -q "requires_rsvp" "$migration"
rg -q "cancellation_source" "$migration"
rg -q "for update" "$migration"
rg -q "Asia/Hong_Kong" "$migration"
rg -q "operational_session_cancelled" "$migration"
rg -q "operational_rsvp_reopened" "$migration"
rg -q "operational_activity_templates_free_one_off_rsvp_check" "$migration"
rg -q "create or replace function public.create_operational_event" "$migration"
rg -q "create or replace function public.join_operational_queue" "$migration"
rg -q "create or replace function public.leave_operational_queue" "$migration"
rg -q "Approved membership required" "$migration"
rg -q "set status = 'dissolved'" "$migration"
rg -q "create or replace function public.set_operational_session_time" "$migration"
rg -q "create or replace function public.set_session_venue" "$migration"
rg -q "operational_session_time_updated" "$migration"

venue_rpc="$(awk '
  /create or replace function public.set_session_venue\(/ { capture = 1 }
  capture { print }
  capture && /^\$\$;$/ { exit }
' "$migration")"
if [[ -z "$venue_rpc" ]] || ! grep -q "p_meeting_lat double precision" <<<"$venue_rpc" \
    || ! grep -q "operational_bookings" <<<"$venue_rpc" \
    || ! grep -q "status = 'confirmed'" <<<"$venue_rpc" \
    || ! grep -q "#/activity/" <<<"$venue_rpc"; then
  echo "FAIL: latest six-argument venue RPC must retain meeting-point validation and target active RSVP bookings" >&2
  exit 1
fi

time_rpc="$(awk '
  /create or replace function public.set_operational_session_time\(/ { capture = 1 }
  capture { print }
  capture && /^\$\$;$/ { exit }
' "$migration")"
if [[ -z "$time_rpc" ]] || ! grep -Eq "is (not )?distinct from" <<<"$time_rpc" \
    || ! grep -q "operational_bookings" <<<"$time_rpc" \
    || ! grep -q "status = 'confirmed'" <<<"$time_rpc" \
    || ! grep -q "#/activity/" <<<"$time_rpc"; then
  echo "FAIL: time RPC must dedupe unchanged values and target active RSVP bookings" >&2
  exit 1
fi

if rg -ni 'grant\s+(all|[^;]*\*)' "$migration"; then
  echo "FAIL: wildcard grants are forbidden" >&2
  exit 1
fi

table_mutation_grant_pattern='grant\s+[^;]*\b(insert|update|delete|truncate|references|trigger)\b[^;]*\bon\s+(table\s+)?public\.[a-z_][a-z0-9_]*[^;]*\bto\s+[^;]*\b(anon|authenticated)\b'
if rg -Uni "$table_mutation_grant_pattern" "$migration"; then
  echo "FAIL: browser roles must not receive direct table mutation grants" >&2
  exit 1
fi

mixed_grant_probe="$(mktemp)"
trap 'rm -f "$mixed_grant_probe"' EXIT
printf '%s\n' \
  'grant select, insert on table public.operational_bookings to authenticated;' \
  'grant select, update on table public.operational_bookings to service_role, anon;' \
  > "$mixed_grant_probe"
if [[ "$(rg -UNic "$table_mutation_grant_pattern" "$mixed_grant_probe")" -ne 2 ]]; then
  echo "FAIL: mutation grant detector must reject mixed privilege and role lists" >&2
  exit 1
fi

rsvp_branch="$(awk '
  /if v_is_rsvp then/ { in_branch = 1 }
  in_branch { print }
  in_branch && /return v_session;/ { exit }
' "$migration")"
if [[ -z "$rsvp_branch" ]] || ! grep -q 'return v_session;' <<<"$rsvp_branch"; then
  echo "FAIL: cancellation dispatcher must have an early-returning RSVP branch" >&2
  exit 1
fi
if grep -Eqi 'defer|deferred|cancel_operational_session_legacy' <<<"$rsvp_branch"; then
  echo "FAIL: RSVP cancellation must return before paid/HYROX deferral behavior" >&2
  exit 1
fi

echo "ok  free-event RSVP migration safety"
