#!/usr/bin/env bash
# Disposable-database concurrency regression for pooled HYROX registration
# and venue allocation. Never run without both explicit safety gates.
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
psql_cmd=("$psql_bin" "$ITC_OPERATIONS_TEST_DATABASE_URL" -X -P pager=off -v ON_ERROR_STOP=1 -q)

if [[ "$("${psql_cmd[@]}" -Atqc "
  select to_regprocedure('public.reserve_hyrox_cycle(text,text,boolean)') is not null
     and to_regprocedure('public.join_hyrox_cycle_waitlist(text,text,boolean)') is not null
     and to_regprocedure('public.select_hyrox_cycle_venue(uuid,text)') is not null
")" != "t" ]]; then
  echo "ERROR: pooled HYROX migrations are not installed on the disposable target." >&2
  exit 3
fi

raw_run_token="$(date -u +%Y%m%d%H%M%S)-$$-${RANDOM}-${RANDOM}"
if command -v sha256sum >/dev/null 2>&1; then
  run_hash="$(printf '%s' "$raw_run_token" | sha256sum | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  run_hash="$(printf '%s' "$raw_run_token" | shasum -a 256 | awk '{print $1}')"
else
  echo "ERROR: sha256sum or shasum is required." >&2
  exit 3
fi
run_token="${run_hash:0:32}"
if [[ ! "$run_token" =~ ^[0-9a-f]{32}$ ]]; then
  echo "ERROR: could not derive a SQL-safe run token." >&2
  exit 3
fi
uuid_prefix="${run_token:0:8}-${run_token:8:4}-4${run_token:13:3}-a${run_token:17:3}-${run_token:20:10}"
member_ids=()
for i in $(seq 1 35); do
  member_ids+=("${uuid_prefix}$(printf '%02d' "$i")")
done

pool_date="$("${psql_cmd[@]}" -Atqc "
  select (now() at time zone 'Asia/Hong_Kong')::date
    + ((6 - extract(dow from (now() at time zone 'Asia/Hong_Kong')::date)::integer + 7) % 7)
    + 504
")"
allocation_date="$("${psql_cmd[@]}" -Atqc "select date '$pool_date' + 7")"
pool_cycle="hyrox-pool-${pool_date}"
allocation_cycle="hyrox-pool-${allocation_date}"
pool_bft="hyrox-bft-${pool_date}"
pool_midtown="hyrox-midtown-${pool_date}"
allocation_bft="hyrox-bft-${allocation_date}"
allocation_midtown="hyrox-midtown-${allocation_date}"

users_sql=""
member_ids_sql=""
for i in $(seq 1 35); do
  id="${member_ids[$((i - 1))]}"
  users_sql+="('$id', 'hyrox-concurrency-${run_token}-${i}@itc.invalid', '{}'::jsonb),"
  member_ids_sql+="'$id',"
done
users_sql="${users_sql%,}"
member_ids_sql="${member_ids_sql%,}"

reserve_sql=""
for i in $(seq 1 31); do
  reserve_sql+="  perform set_config('request.jwt.claim.sub', '${member_ids[$((i - 1))]}', true); perform public.reserve_hyrox_cycle('${pool_cycle}', 'either', true);\n"
done

allocation_values=""
for i in $(seq 1 31); do
  id="${member_ids[$((i - 1))]}"
  if (( i <= 19 )); then session="$allocation_bft"; preference="bft"; else session="$allocation_midtown"; preference="midtown"; fi
  allocation_values+="('$id', '$session', '${allocation_cycle}', 'confirmed', now(), now() + interval '2 days', '$preference', now(), 'provisional', 'automatic', now(), jsonb_build_array(jsonb_build_object('session_id', '$session')), '{\"name\":\"ITC HYROX\",\"booking_mode\":\"weekly_pool\"}'::jsonb),"
done
allocation_values="${allocation_values%,}"

work_dir="$(mktemp -d)"
background_pids=()
run_sql() { "${psql_cmd[@]}" -c "$1"; }

cleanup() {
  local original_status=$?
  trap - EXIT
  set +e
  for pid in "${background_pids[@]:-}"; do kill "$pid" 2>/dev/null; done
  for pid in "${background_pids[@]:-}"; do wait "$pid" 2>/dev/null; done
  "${psql_cmd[@]}" -c "
    begin;
    delete from public.operational_hyrox_queue_entries
     where cycle_id in ('$pool_cycle', '$allocation_cycle');
    delete from public.operational_bookings
     where hyrox_cycle_id in ('$pool_cycle', '$allocation_cycle');
    delete from public.operational_hyrox_cycles
     where id in ('$pool_cycle', '$allocation_cycle');
    delete from public.operational_sessions
     where id in ('$pool_bft', '$pool_midtown', '$allocation_bft', '$allocation_midtown');
    delete from auth.users where id in ($member_ids_sql);
    commit;
  " >/dev/null 2>&1
  rm -rf "$work_dir"
  exit "$original_status"
}
trap cleanup EXIT

run_sql "
  insert into auth.users (id, email, raw_user_meta_data) values $users_sql;
  update public.profiles set role = 'member'
   where id in ($member_ids_sql);
  select public.ensure_operational_sessions(date '$pool_date', 2);
  select public.ensure_operational_sessions(date '$allocation_date', 2);
  begin;
  select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  select public.schedule_hyrox_cycle('$pool_cycle');
  select public.schedule_hyrox_cycle('$allocation_cycle');
  reset role;
  commit;
  update public.operational_hyrox_cycles
     set registration_state = 'open', opened_at = now(),
         registration_opens_at = now() - interval '1 hour'
   where id = '$pool_cycle';
  update public.operational_hyrox_cycles
     set registration_state = 'closed', venue_plan = 'both',
         reconciliation_started_at = now(), plan_confirmed_at = now(),
         plan_confirmed_source = 'automatic_sweep'
   where id = '$allocation_cycle';
"

run_sql "
  begin;
  set local statement_timeout = '20s';
  set local role authenticated;
  do \$\$
begin
$(printf '%b' "$reserve_sql")
end
\$\$;
  reset role;
  commit;
"

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
  if [[ "$status_a" == "$status_b" ]]; then
    echo "FAIL: $label expected exactly one success and one failure ($status_a/$status_b)" >&2
    cat "$out_a" "$out_b" >&2
    exit 1
  fi
}

reserve_race_a="
  begin;
  set local lock_timeout = '5s'; set local statement_timeout = '10s';
  set local deadlock_timeout = '100ms';
  select set_config('request.jwt.claim.sub', '${member_ids[31]}', true);
  set local role authenticated;
  select id from public.reserve_hyrox_cycle('$pool_cycle', 'either', true);
  select pg_sleep(0.25);
  commit;
"
reserve_race_b="${reserve_race_a//${member_ids[31]}/${member_ids[32]}}"
run_pair "pooled-reservations" "$reserve_race_a" "$reserve_race_b"

active_count="$("${psql_cmd[@]}" -Atqc "select count(*) from public.operational_bookings where hyrox_cycle_id = '$pool_cycle' and status in ('reserved','confirmed')")"
if [[ "$active_count" != "32" ]]; then
  echo "FAIL: pooled reservation race produced $active_count active bookings, expected 32" >&2
  exit 1
fi
loser="$("${psql_cmd[@]}" -Atqc "
  select x.profile_id from (values ('${member_ids[31]}'::uuid), ('${member_ids[32]}'::uuid)) x(profile_id)
   where not exists (select 1 from public.operational_bookings b
      where b.hyrox_cycle_id = '$pool_cycle' and b.profile_id = x.profile_id
        and b.status in ('reserved','confirmed'))
")"
if [[ -z "$loser" ]]; then
  echo "FAIL: could not identify the losing pooled reservation" >&2
  exit 1
fi
run_sql "
  begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '$loser', true);
  select public.join_hyrox_cycle_waitlist('$pool_cycle', 'either', true);
  commit;
"
run_sql "
  do \$\$
begin
  if (select count(*) from public.operational_hyrox_queue_entries
       where cycle_id = '$pool_cycle' and kind = 'weekly_waitlist' and status = 'active') <> 1
     or not exists (select 1 from public.operational_hyrox_queue_entries
       where cycle_id = '$pool_cycle' and profile_id = '$loser'
         and kind = 'weekly_waitlist' and status = 'active') then
    raise exception 'losing member did not become weekly waitlist position one';
  end if;
end
\$\$;
"

run_sql "
  insert into public.operational_bookings
    (profile_id, session_id, hyrox_cycle_id, status, reserved_at,
     pay_deadline_at, venue_preference, fallback_acknowledged_at,
     allocation_state, allocation_source, allocated_at, allocation_snapshot, snapshot)
  values $allocation_values;
"
move_booking_a="$("${psql_cmd[@]}" -Atqc "select id from public.operational_bookings where hyrox_cycle_id = '$allocation_cycle' and profile_id = '${member_ids[19]}'")"
move_booking_b="$("${psql_cmd[@]}" -Atqc "select id from public.operational_bookings where hyrox_cycle_id = '$allocation_cycle' and profile_id = '${member_ids[20]}'")"
move_sql_a="
  begin;
  set local lock_timeout = '5s'; set local statement_timeout = '10s';
  set local deadlock_timeout = '100ms';
  select set_config('request.jwt.claim.sub', '${member_ids[19]}', true);
  set local role authenticated;
  select id from public.select_hyrox_cycle_venue('$move_booking_a', '$allocation_bft');
  select pg_sleep(0.25);
  commit;
"
move_sql_b="${move_sql_a//${member_ids[19]}/${member_ids[20]}}"
move_sql_b="${move_sql_b//$move_booking_a/$move_booking_b}"
run_pair "last-bft-venue-moves" "$move_sql_a" "$move_sql_b"
run_sql "
  do \$\$
begin
  if (select count(*) from public.operational_bookings
       where hyrox_cycle_id = '$allocation_cycle' and status = 'confirmed'
         and session_id = '$allocation_bft') > 20
     or (select count(*) from public.operational_bookings
       where hyrox_cycle_id = '$allocation_cycle' and status = 'confirmed'
         and session_id = '$allocation_midtown') > 12 then
    raise exception 'concurrent venue moves exceeded 20/12 capacity';
  end if;
end
\$\$;
"

echo "HYROX pooled concurrency verification passed: 32-place reservation and 20/12 venue allocation remain serialized."
