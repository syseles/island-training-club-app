# Admin Notifications Database Verification

This check applies every repository migration to a **fresh disposable Supabase-compatible PostgreSQL database**, then executes trigger, audit, fan-out, browser privilege, and row-level security assertions.

## Safety and prerequisites

- PostgreSQL `psql` client (override its executable path with `ITC_NOTIFICATION_PSQL_BIN` when needed).
- A disposable database that already has Supabase's `auth` schema/functions and `anon` / `authenticated` roles.
- The target must have no `public.profiles`, zero rows in `auth.users`, and no non-extension-owned relations, routines, or standalone types in `public`. The script checks all three conditions before applying a migration.
- `ITC_ALLOW_DATABASE_RESET=1` is a separate explicit acknowledgement; it never bypasses the database freshness checks.
- Never use a production, shared, or developer database: migrations are applied permanently. Test fixtures themselves run in a transaction and roll back.

## Run

```sh
export ITC_NOTIFICATION_TEST_DATABASE_URL='postgresql://...disposable database...'
export ITC_ALLOW_DATABASE_RESET=1
./supabase/tests/verify_admin_notifications.sh
```

The command exits nonzero on a migration error or failed assertion. To exercise only the non-destructive preflight, use `--safety-check-only`. The gate's accepted/rejected states have a mock-client regression test:

```sh
./supabase/tests/verify_admin_notifications_safety.sh
```

The full command verifies:

- clean application of all migrations, including the rerunnable read-column privilege migration;
- submitted insert fan-out and no duplicate on ordinary application edits;
- approval/decline/promote/demote/revoke kinds and event-time recipient fan-out;
- preserved role audit and welcome delivery;
- audit preservation without operational fan-out for unsupported role transitions;
- nullable/fallback actor behavior;
- authenticated self-row `read_at` update success;
- denial of trusted-content updates and cross-recipient updates;
- denial of notification updates to the anonymous role.

The current schema defines `applications.submitted_at` as `NOT NULL DEFAULT now()`, so a null-to-non-null transition cannot be created against the migrated schema. The trigger source retains that defensive path, while this executable check exercises the reachable submitted-insert and duplicate-suppression behavior. If draft applications become schema-supported later, add an executable null-to-non-null case here.

## Local Supabase option

If the Supabase CLI and PostgreSQL client are installed, start a disposable local project/database, obtain its direct PostgreSQL URL, and pass that URL to the command above. Do not point the external verifier at an already migrated `supabase start` database; create/reset a fresh target because the verifier owns migration application.

For a CLI-managed project where `supabase start`/`supabase db reset` applies the copied migrations itself, run `admin_notifications_integration.sql` directly in that verifier-owned local Postgres container. This validates clean CLI migration application and the same transactional assertions without misusing the external verifier's pre-migration safety gate. Never link the disposable project or supply remote database credentials.
