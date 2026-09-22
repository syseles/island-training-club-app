#!/usr/bin/env python3
"""Offline exact-statement safety contract; --sql emits rollback-only integration."""
import hashlib
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase/migrations'
NAME = '20260922000003_reassert_retired_hyrox_pool_acls.sql'
EXPECTED = [
    'drop policy if exists "public read HYROX cycles" on public.operational_hyrox_cycles',
    'drop policy if exists "member read own HYROX cycle queues" on public.operational_hyrox_queue_entries',
    'revoke select on table public.operational_hyrox_cycles from public, anon, authenticated',
    'revoke select on table public.operational_hyrox_queue_entries from public, anon, authenticated',
    'revoke execute on function public.ensure_hyrox_cycles(date, integer) from public, anon, authenticated',
    "notify pgrst, 'reload schema'",
]


def check(source):
    statements = [' '.join(s.split()) for s in re.sub(r'--[^\n]*', '', source).split(';') if s.strip()]
    assert statements == EXPECTED, '00003 must contain only the six reviewed statements, in order'


def safety():
    for name, digest in [
        ('20260922000001_retire_bft_midtown_hyrox_pool.sql', '81f66371c360d9e6aed31f4130f38df891aad4100abdbddf2aa1c0d92e7aadb8'),
        ('20260922000002_harden_retired_hyrox_boundary.sql', '1bb968bdbe435d4cad66a1fec993946c5b67692e8f1b25e53b1bde85e2edb6eb'),
    ]:
        assert hashlib.sha256((MIGRATIONS / name).read_bytes()).hexdigest() == digest, 'never edit 00001/00002'
    versions = [p.name.split('_')[0] for p in MIGRATIONS.glob('*.sql')]
    assert len(versions) == len(set(versions))
    assert sorted(p.name for p in MIGRATIONS.glob('*.sql'))[-1] == NAME
    source = (MIGRATIONS / NAME).read_text()
    check(source)
    negatives = [source.replace('from public, anon, authenticated', 'from anon, authenticated', 1),
                 source.replace('if exists', '', 1), source.replace('revoke execute', 'grant execute')]
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
        print(source.replace('-- APPLY 00003', '' if '--red' in sys.argv else (MIGRATIONS / NAME).read_text()))
    else:
        print('OK: 00003 exact scope, immutable 00001/00002, unique tip and negative safety controls')
