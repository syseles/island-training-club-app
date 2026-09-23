#!/usr/bin/env python3
"""Source safety or rollback-only integration on the fixed disposable local container.

--integration --red reproduces production drift without applying 00002.
No Supabase link, remote connection string, or shared service is used.
"""
import hashlib
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "supabase/migrations"
NEW = MIGRATIONS / "20260922000002_harden_retired_hyrox_boundary.sql"
OLD = MIGRATIONS / "20260922000001_retire_bft_midtown_hyrox_pool.sql"
NAME = "get_operational_attendee_names_pre_pool_retirement_20260922"


def attendee_definition(filename):
    source = (MIGRATIONS / filename).read_text()
    return re.search(
        r"create or replace function public\.get_operational_attendee_names\([\s\S]*?\n\$\$;",
        source,
    )[0].replace("public.get_operational_attendee_names(", f"public.{NAME}(")


def safety():
    assert hashlib.sha256(OLD.read_bytes()).hexdigest() == (
        "81f66371c360d9e6aed31f4130f38df891aad4100abdbddf2aa1c0d92e7aadb8"
    ), "applied 00001 must remain byte-identical"
    versions = [p.name.split('_')[0] for p in MIGRATIONS.glob('*.sql')]
    assert len(versions) == len(set(versions)), "migration versions must be unique"
    assert NEW.exists(), "forward correction 00002 is missing"
    source = NEW.read_text()
    definition = attendee_definition("20260910000002_operational_attendee_names_rsvp.sql")
    assert definition in source, "preserved roster must match exact latest historical definition"
    # This correction may only replace that definition and perform scoped ACL /
    # owner changes. No DO, policy/default-ACL rewrite, data mutation, or job call.
    remainder = re.sub(r"--[^\n]*", "", source.replace(definition, ""))
    statements = [' '.join(s.split()) for s in remainder.split(';') if s.strip()]
    for statement in statements:
        assert re.fullmatch(
            r"(?:revoke (?:all(?: privileges)?(?: \([^)]*\))?|execute) on (?:function|table) "
            r"(?:public|private)\.[\w]+(?:\([^)]*\))?\s+from [\w,\s]+"
            r"|grant (?:select|update \(read_at\)) on table public.notifications to authenticated"
            r"|grant execute on function public.operational_is_retired_hyrox_session\(text\)\s+to service_role"
            rf"|alter function public\.{NAME}\(text\) owner to postgres"
            r"|notify pgrst, 'reload schema')",
            statement, re.I,
        ), f"unexpected forward-correction statement: {statement}"
    for signature in [
        "public.operational_is_retired_hyrox_activity(text)",
        "public.operational_is_retired_hyrox_booking(uuid)",
        "public.operational_notification_is_retired_hyrox(text, text, timestamptz, text, text)",
    ]:
        assert re.search(r"revoke execute on function " + re.escape(signature)
                         + r"\s+from service_role;", source), signature
    assert re.search(rf"revoke all on function public\.{NAME}\(text\)\s+"
                     r"from public, anon, authenticated, service_role;", source)
    assert "revoke all on table public.notifications from public, anon, authenticated;" in source
    assert "grant select on table public.notifications to authenticated;" in source
    assert "grant update (read_at) on table public.notifications to authenticated;" in source
    print("OK: forward correction source safety and exact historical roster parity")


def integration(red):
    source = (ROOT / "supabase/tests/retired_hyrox_correction_integration.sql").read_text()
    source = source.replace("-- RESTORE PRODUCTION ATTENDEE BODY", attendee_definition(
        "20260910000001_operational_replacement_requests.sql"))
    source = source.replace("-- APPLY FORWARD CORRECTION", "" if red else NEW.read_text())
    # Fixed local container only. ON_ERROR_STOP terminates the connection on RED,
    # automatically rolling back the entire transaction, including default ACLs.
    command = [
        "docker", "exec", "-i", "supabase_db_island-training-club-app",
        "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1",
    ]
    snapshot_sql = """
      select md5(jsonb_build_array(
        (select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),
        (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public', 'private')),
        (select relacl from pg_class where oid = 'public.notifications'::regclass),
        (select jsonb_agg(attacl order by attnum) from pg_attribute
          where attrelid = 'public.notifications'::regclass),
        (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p
          where schemaname = 'public' and tablename = 'notifications'),
        (select jsonb_agg(to_jsonb(n) order by id) from public.notifications n),
        (select jsonb_agg(id order by id) from auth.users),
        (select jsonb_agg(to_jsonb(s) order by id) from public.operational_sessions s),
        (select jsonb_agg(to_jsonb(b) order by id) from public.operational_bookings b)
      )::text);
    """

    def snapshot():
        return subprocess.run(command + ['-At'], input=snapshot_sql,
                              text=True, capture_output=True, check=True).stdout.strip()

    before = snapshot()
    result = subprocess.run(command, input=source, text=True, check=False)
    assert snapshot() == before, "integration must roll back schema, ACLs and fixtures even on RED"
    print("OK: independent before/after rollback snapshot equality", flush=True)
    sys.exit(result.returncode)


if __name__ == "__main__":
    if "--integration" in sys.argv:
        integration("--red" in sys.argv)
    else:
        safety()
