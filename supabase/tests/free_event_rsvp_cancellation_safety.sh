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

if rg -ni 'grant\s+(all|[^;]*\*)' "$migration"; then
  echo "FAIL: wildcard grants are forbidden" >&2
  exit 1
fi

if rg -ni 'grant\s+(insert|update|delete|truncate|references|trigger)(\s*,\s*(insert|update|delete|truncate|references|trigger))*\s+on\s+(table\s+)?public\.[a-z_]+\s+to\s+(anon|authenticated)' "$migration"; then
  echo "FAIL: browser roles must not receive direct table mutation grants" >&2
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
