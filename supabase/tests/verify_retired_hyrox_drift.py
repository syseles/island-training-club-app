#!/usr/bin/env python3
"""Offline exact-statement safety contract; --sql emits rollback-only integration."""
import hashlib
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase/migrations'
NAME = '20260922000003_reassert_retired_hyrox_pool_acls.sql'
# Six retired jobs, then all twelve RPCs in 00001's Pool-only browser RPCs
# section. Independent explicit contract, cross-checked against immutable source.
POOL_FUNCTIONS = [
    'ensure_hyrox_cycles(date, integer)',
    'schedule_hyrox_cycle(text)',
    'sweep_hyrox_cycle_deadlines(timestamptz)',
    'send_hyrox_member_payment_reminders(timestamptz)',
    'send_hyrox_collector_payment_reminder(timestamptz)',
    'send_hyrox_venue_reminders(timestamptz)',
    'reserve_hyrox_cycle(text, text, boolean)',
    'join_hyrox_cycle_waitlist(text, text, boolean)',
    'leave_hyrox_cycle_queue(uuid)',
    'reject_hyrox_cycle_payment(uuid, text)',
    'finalize_hyrox_venue_plan(text)',
    'finalize_hyrox_venue_plan_locked(text, timestamptz, text, uuid)',
    'select_hyrox_cycle_venue(uuid, text)',
    'join_hyrox_venue_switch_queue(uuid, text)',
    'leave_hyrox_venue_switch_queue(uuid)',
    'close_hyrox_venue_allocation(text)',
    'cancel_hyrox_cycle(text, text)',
    'set_operational_midtown_open(text, boolean)',
]
EXPECTED = [
    'drop policy if exists "public read HYROX cycles" on public.operational_hyrox_cycles',
    'drop policy if exists "member read own HYROX cycle queues" on public.operational_hyrox_queue_entries',
    'revoke select on table public.operational_hyrox_cycles from public, anon, authenticated',
    'revoke select on table public.operational_hyrox_queue_entries from public, anon, authenticated',
    *[f'revoke execute on function public.{f} from public, anon, authenticated' for f in POOL_FUNCTIONS],
    "notify pgrst, 'reload schema'",
]


def statements(source):
    return [' '.join(s.split()) for s in re.sub(r'--[^\n]*', '', source).split(';') if s.strip()]


def check(source):
    assert statements(source) == EXPECTED, '00003 must contain only the 23 reviewed statements, in order'


def source_boundary():
    old = (MIGRATIONS / '20260922000001_retire_bft_midtown_hyrox_pool.sql').read_text()
    boundary = old[old.index('revoke all on function public.ensure_hyrox_cycles('):old.index('-- Shared RPC guards')]
    revoked = re.findall(r'revoke (?:all|execute) on function public\.(\w+\([^)]*\))\s+from public, anon, authenticated;', boundary)
    assert [' '.join(f.split()) for f in revoked] == POOL_FUNCTIONS, 'complete pool-only set must equal immutable 00001'
    for policy in EXPECTED[:2]:
        assert policy in statements(old), 'exact historical policy drop required'
    for table in EXPECTED[2:4]:
        assert table.replace('from public, anon, authenticated', 'from anon, authenticated') in statements(old)
    shared = re.findall(r'grant execute on function public\.(\w+\([^)]*\)) to authenticated;', old)
    # This trigger function is not in 00001's pool-only revocations either.
    shared += ['suppress_opted_out_hyrox_payment_reminder()']
    assert len(shared) == 24 and not set(shared) & set(POOL_FUNCTIONS)
    # No invented approve_hyrox_cycle_payment overload: approval is the guarded
    # shared approve_operational_payment(uuid), and must remain authenticated.
    assert 'approve_operational_payment(uuid)' in shared
    return shared


def safety():
    for name, digest in [
        ('20260922000001_retire_bft_midtown_hyrox_pool.sql', '81f66371c360d9e6aed31f4130f38df891aad4100abdbddf2aa1c0d92e7aadb8'),
        ('20260922000002_harden_retired_hyrox_boundary.sql', '1bb968bdbe435d4cad66a1fec993946c5b67692e8f1b25e53b1bde85e2edb6eb'),
    ]:
        assert hashlib.sha256((MIGRATIONS / name).read_bytes()).hexdigest() == digest, 'never edit 00001/00002'
    shared = source_boundary()
    versions = [p.name.split('_')[0] for p in MIGRATIONS.glob('*.sql')]
    assert len(versions) == len(set(versions))
    assert sorted(p.name for p in MIGRATIONS.glob('*.sql'))[-1] == NAME
    source = (MIGRATIONS / NAME).read_text()
    check(source)
    negatives = [source.replace('from public, anon, authenticated', 'from anon, authenticated', 1),
                 source.replace('if exists', '', 1), source.replace('revoke execute', 'grant execute'),
                 ';\n'.join(reversed(EXPECTED)) + ';']
    for statement in EXPECTED[4:-1]:
        negatives += [source.replace(statement + ';', ''),
                      source.replace(statement, statement.replace('public.', 'private.')),
                      source.replace(statement, statement.replace('public, anon, authenticated', 'public, anon')),
                      source.replace(statement, statement.replace('public, anon, authenticated', 'public, anon, authenticated, service_role')),
                      source.replace(statement, statement.replace(')', ', text)'))]
    negatives += [source + f'\nrevoke execute on function public.{f} from public, anon, authenticated;' for f in shared]
    negatives += [source + '\n' + s + ';' for s in [
        'delete from public.notifications', 'alter default privileges revoke execute on functions from public',
        'alter table public.operational_hyrox_cycles disable row level security',
        'grant select on public.profiles to anon', "notify other, 'x'", 'select public.ensure_hyrox_cycles(current_date, 1)',
        'update supabase_migrations.schema_migrations set name = name',
    ]]
    for bad in negatives:
        try:
            check(bad)
        except AssertionError:
            continue
        raise AssertionError('unsafe mutation accepted')


if __name__ == '__main__':
    safety()
    if '--sql' in sys.argv:
        source = (ROOT / 'supabase/tests/retired_hyrox_drift_integration.sql').read_text()
        values = ',\n'.join(f"('public.{f}')" for f in POOL_FUNCTIONS)
        source = source.replace('-- POOL FUNCTION SIGNATURES', f'insert into drift_functions values {values};')
        print(source.replace('-- APPLY 00003', '' if '--red' in sys.argv else (MIGRATIONS / NAME).read_text()))
    else:
        print('OK: 00003 exact 23 statements / 18 pool-only functions derived from immutable 00001; shared RPCs preserved; negative safety controls')
