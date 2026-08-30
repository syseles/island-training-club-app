#!/usr/bin/env bash
# Bounded disposable-database concurrency regression for RSVP count locking.
# Run only after the ordered migrations have been applied by
# verify_operational_backend.sh.
set -euo pipefail

if [[ -z "${ITC_OPERATIONS_TEST_DATABASE_URL:-}" ]]; then
  echo "ERROR: set ITC_OPERATIONS_TEST_DATABASE_URL to the acknowledged disposable database." >&2
  exit 2
fi
if [[ "${ITC_ALLOW_DATABASE_RESET:-}" != "1" ]]; then
  echo "ERROR: set ITC_ALLOW_DATABASE_RESET=1 to confirm the target is disposable." >&2
  exit 2
fi

psql_bin="${ITC_OPERATIONS_PSQL_BIN:-psql}"
if ! command -v "$psql_bin" >/dev/null 2>&1; then
  echo "ERROR: psql is required (PostgreSQL client)." >&2
  exit 2
fi
if [[ "${1:-}" == "--safety-check-only" ]]; then
  exit 0
fi
if [[ $# -gt 0 ]]; then
  echo "ERROR: unknown argument: $1" >&2
  exit 2
fi

export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-5}"
psql_cmd=("$psql_bin" "$ITC_OPERATIONS_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

if [[ "$("${psql_cmd[@]}" -Atqc "
  select to_regclass('public.operational_bookings') is not null
     and to_regprocedure('public.recalculate_operational_rsvp_count(text)') is not null
")" != "t" ]]; then
  echo "ERROR: ordered operational migrations are not installed on the disposable target." >&2
  exit 3
fi

fixture_dates="$("${psql_cmd[@]}" -Atqc "
  with dates as (
    select (now() at time zone 'Asia/Hong_Kong')::date + 500 as paid_date
  )
  select concat_ws('|', paid_date, paid_date + 1, paid_date + 2)
    from dates
")"
IFS='|' read -r paid_date rsvp_date_a rsvp_date_b <<<"$fixture_dates"
if [[ -z "$paid_date" || -z "$rsvp_date_a" || -z "$rsvp_date_b" ]]; then
  echo "ERROR: could not derive dynamic HKT fixture dates." >&2
  exit 3
fi

member_a="91000000-0000-0000-0000-000000000001"
member_b="91000000-0000-0000-0000-000000000002"
member_c="91000000-0000-0000-0000-000000000003"
paid_booking="92000000-0000-0000-0000-000000000001"
rsvp_booking_a="92000000-0000-0000-0000-000000000002"
rsvp_booking_b="92000000-0000-0000-0000-000000000003"
paid_activity="event-concurrency-paid"
rsvp_activity="event-concurrency-rsvp"
paid_session="${paid_activity}-${paid_date}"
rsvp_session_a="${rsvp_activity}-${rsvp_date_a}"
rsvp_session_b="${rsvp_activity}-${rsvp_date_b}"

work_dir="$(mktemp -d)"
background_pids=()

run_sql() {
  "${psql_cmd[@]}" -c "$1"
}

cleanup() {
  local original_status=$?
  trap - EXIT
  set +e
  for pid in "${background_pids[@]:-}"; do
    kill "$pid" 2>/dev/null
  done
  for pid in "${background_pids[@]:-}"; do
    wait "$pid" 2>/dev/null
  done
  "${psql_cmd[@]}" -c "
    begin;
    set local lock_timeout = '2s';
    set local statement_timeout = '5s';
    delete from public.operational_bookings
     where session_id in ('$paid_session', '$rsvp_session_a', '$rsvp_session_b');
    delete from public.operational_sessions
     where id in ('$paid_session', '$rsvp_session_a', '$rsvp_session_b');
    delete from public.operational_activity_templates
     where activity_id in ('$paid_activity', '$rsvp_activity');
    delete from auth.users where id in ('$member_a', '$member_b', '$member_c');
    commit;
  " >/dev/null 2>&1
  rm -rf "$work_dir"
  exit "$original_status"
}
trap cleanup EXIT

run_pair() {
  local label="$1" sql_a="$2" sql_b="$3"
  local out_a="$work_dir/${label}-a.out" out_b="$work_dir/${label}-b.out"
  set +e
  "${psql_cmd[@]}" -c "$sql_a" >"$out_a" 2>&1 &
  local pid_a=$!
  background_pids+=("$pid_a")
  "${psql_cmd[@]}" -c "$sql_b" >"$out_b" 2>&1 &
  local pid_b=$!
  background_pids+=("$pid_b")
  wait "$pid_a"; local status_a=$?
  wait "$pid_b"; local status_b=$?
  set -e
  background_pids=()
  if [[ "$status_a" != "0" || "$status_b" != "0" ]]; then
    echo "FAIL: $label concurrency pair failed ($status_a/$status_b)" >&2
    cat "$out_a" "$out_b" >&2
    exit 1
  fi
}

run_sql "
  insert into auth.users (id, email, raw_user_meta_data) values
    ('$member_a', 'concurrency-a@itc.invalid', '{}'::jsonb),
    ('$member_b', 'concurrency-b@itc.invalid', '{}'::jsonb),
    ('$member_c', 'concurrency-c@itc.invalid', '{}'::jsonb);
  update public.profiles set role = 'member'
   where id in ('$member_a', '$member_b', '$member_c');
  insert into public.operational_activity_templates
    (activity_id, name, venue, weekday, start_time, duration_minutes,
     capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
  values
    ('$paid_activity', 'Concurrency Paid', 'BFT Causeway Bay',
     extract(dow from date '$paid_date')::integer,
     time '11:00', 60, 20, 180, true, false, 'HYROX', 'BFT Causeway Bay', false),
    ('$rsvp_activity', 'Concurrency RSVP', 'TBC',
     extract(dow from date '$rsvp_date_a')::integer,
     time '12:00', 60, null, 0, true, false, 'Socials', null, true);
  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    ('$paid_session', '$paid_activity', date '$paid_date',
     time '11:00', 60, 'BFT Causeway Bay', 20, 180, true),
    ('$rsvp_session_a', '$rsvp_activity', date '$rsvp_date_a',
     time '12:00', 60, 'TBC', null, 0, true),
    ('$rsvp_session_b', '$rsvp_activity', date '$rsvp_date_b',
     time '12:00', 60, 'TBC', null, 0, true);
  insert into public.operational_bookings
    (id, profile_id, session_id, status, pay_deadline_at, snapshot)
  values
    ('$paid_booking', '$member_a', '$paid_session', 'reserved', now() + interval '1 day',
     jsonb_build_object('name', 'Concurrency Paid', 'session_date', date '$paid_date',
       'start_time', '11:00', 'venue', 'BFT Causeway Bay', 'price_hkd', 180));
"

# Hold the paid session at FOR SHARE in A. mark_operational_payment also takes
# FOR SHARE; only the obsolete broad trigger tries to upgrade to FOR UPDATE.
ready_file="$work_dir/paid-share-ready"
cat >"$work_dir/hold-paid-share.sql" <<SQL
begin;
set local statement_timeout = '6s';
select id from public.operational_sessions where id = '$paid_session' for share;
\! touch "$ready_file"
select pg_sleep(4);
commit;
SQL
"${psql_cmd[@]}" -f "$work_dir/hold-paid-share.sql" >"$work_dir/paid-share.out" 2>&1 &
holder_pid=$!
background_pids+=("$holder_pid")
for _ in $(seq 1 50); do
  [[ -e "$ready_file" ]] && break
  sleep 0.1
done
if [[ ! -e "$ready_file" ]]; then
  echo "FAIL: paid-share holder did not become ready within five seconds" >&2
  exit 1
fi

run_sql "
  begin;
  set local lock_timeout = '1500ms';
  set local statement_timeout = '3s';
  set local deadlock_timeout = '100ms';
  select set_config('request.jwt.claim.sub', '$member_a', true);
  set local role authenticated;
  select id from public.mark_operational_payment('$paid_booking', 'payme', 'CONCURRENCY');
  commit;
"
wait "$holder_pid"
background_pids=()
run_sql "
  do \$\$
  begin
    if not exists (
      select 1 from public.operational_bookings
       where id = '$paid_booking' and payment_reference = 'CONCURRENCY'
    ) then
      raise exception 'paid update did not settle while another transaction held session FOR SHARE';
    end if;
    if exists (
      select 1 from public.operational_rsvp_counts where session_id = '$paid_session'
    ) then
      raise exception 'paid update created an RSVP count row';
    end if;
  end
  \$\$;
"

insert_a="
  begin;
  set local lock_timeout = '2s';
  set local statement_timeout = '5s';
  set local deadlock_timeout = '100ms';
  insert into public.operational_bookings
    (id, profile_id, session_id, status, pay_deadline_at, paid_at, snapshot)
  values ('$rsvp_booking_a', '$member_b', '$rsvp_session_a', 'confirmed', now(), now(), '{}'::jsonb);
  select pg_sleep(0.25);
  commit;
"
insert_b="${insert_a//$rsvp_booking_a/$rsvp_booking_b}"
insert_b="${insert_b//$member_b/$member_c}"
run_pair "rsvp-inserts" "$insert_a" "$insert_b"
run_sql "
  do \$\$
  begin
    if (select going_count from public.operational_rsvp_counts
         where session_id = '$rsvp_session_a') <> 2 then
      raise exception 'concurrent RSVP inserts did not produce exact count two';
    end if;
  end
  \$\$;
"

delete_a="
  begin;
  set local lock_timeout = '2s';
  set local statement_timeout = '5s';
  set local deadlock_timeout = '100ms';
  delete from public.operational_bookings where id = '$rsvp_booking_a';
  select pg_sleep(0.25);
  commit;
"
delete_b="${delete_a//$rsvp_booking_a/$rsvp_booking_b}"
run_pair "rsvp-deletes" "$delete_a" "$delete_b"
run_sql "
  do \$\$
  begin
    if (select going_count from public.operational_rsvp_counts
         where session_id = '$rsvp_session_a') <> 0 then
      raise exception 'concurrent RSVP deletes did not retain exact zero';
    end if;
  end
  \$\$;
  insert into public.operational_bookings
    (id, profile_id, session_id, status, pay_deadline_at, paid_at, snapshot)
  values
    ('$rsvp_booking_a', '$member_b', '$rsvp_session_a', 'confirmed', now(), now(), '{}'::jsonb),
    ('$rsvp_booking_b', '$member_c', '$rsvp_session_b', 'confirmed', now(), now(), '{}'::jsonb);
"

move_a="
  begin;
  set local lock_timeout = '2s';
  set local statement_timeout = '5s';
  set local deadlock_timeout = '100ms';
  update public.operational_bookings set session_id = '$rsvp_session_b'
   where id = '$rsvp_booking_a';
  select pg_sleep(0.25);
  commit;
"
move_b="
  begin;
  set local lock_timeout = '2s';
  set local statement_timeout = '5s';
  set local deadlock_timeout = '100ms';
  update public.operational_bookings set session_id = '$rsvp_session_a'
   where id = '$rsvp_booking_b';
  select pg_sleep(0.25);
  commit;
"
run_pair "opposing-rsvp-moves" "$move_a" "$move_b"
run_sql "
  do \$\$
  begin
    if (select going_count from public.operational_rsvp_counts
         where session_id = '$rsvp_session_a') <> 1
       or (select going_count from public.operational_rsvp_counts
         where session_id = '$rsvp_session_b') <> 1 then
      raise exception 'opposing RSVP moves did not retain exact one/one totals';
    end if;
  end
  \$\$;
"

echo "RSVP concurrency verification passed: paid updates avoid the serializer and RSVP mutations settle exactly."
