# Task 2 Report — Semantic notification destinations

## Status

Implemented Task 2 on `feature/notification-routing` with one forward-only migration:

- `20260829000007_notification_destinations.sql` adds the centralized `STABLE`, `SECURITY DEFINER`, fixed-search-path resolver.
- One `BEFORE INSERT` trigger preserves explicit internal routes and resolves missing or malformed destinations.
- Entity matching is timestamp-bounded, exact-one only, and booking matching is scoped by `profile_id`.
- Stable kinds use the approved section routes.
- The backfill updates only resolvable null/malformed destinations and does not assign any other notification column.
- Resolver and trigger-function execution is revoked from `public`, `anon`, and `authenticated`.
- No notification producer, RLS policy/state, table-write grant, client code, or localStorage shape was changed.

## RED evidence

After adding the migration source contract to `app/smoke.mjs` and before creating migration `00007`:

```sh
node app/smoke.mjs
```

Exited 1 with the expected missing-feature error:

```text
Error: ENOENT: no such file or directory, open '.../supabase/migrations/20260829000007_notification_destinations.sql'
```

The negative access contract also passed a mutation check. Temporarily appending:

```sql
grant select, update on table public.notifications to authenticated;
```

made `node app/smoke.mjs` exit 1 with:

```text
Error: notification routing migration must not grant notification-table writes
```

The migration was restored before final verification.

## GREEN evidence

After implementing migration `00007`:

```sh
node app/smoke.mjs
```

Exited 0, including:

```text
ok  notification migration centralizes exact routes without weakening notification access
All smoke tests passed.
```

The source contract requires the approved resolver/trigger/security markers, rejects notification RLS alteration and notification-table write grants, and permits only the two centralized function declarations in this migration.

## SQL integration evidence

`supabase/tests/operational_backend_integration.sql` now contains rollback-scoped assertions for:

- paid reservation → exact `#/pay/<booking-id>`;
- RSVP → exact `#/booking/<booking-id>`;
- payment approval → exact resulting Booking Details route;
- cancellation deferral → exact new booking route;
- payment-marked and gym-finalized Admin notifications → `#/admin/payments`;
- explicit `#/giving` preservation;
- all approved stable section routes;
- both session-cancellation kinds → unique `#/activity/<session-id>` routes;
- unique same-profile historical reservation backfill;
- same-time ambiguity remaining unresolved;
- another profile's booking never being selected;
- existing `read_at` preservation;
- resolver/trigger existence and lack of browser-role execution privilege.

The historical fixtures insert notifications before their candidate bookings, then execute the same guarded backfill statement as the migration. This exercises post-insert historical resolution without disabling the insert trigger.

Database execution evidence is **not available** in this environment: there is no disposable database URL/reset acknowledgement, `psql` and Supabase CLI are unavailable, and the Docker daemon is not running. The SQL integration source was therefore added and reviewed but not executed or deployed.

## Available checks

Fresh final verification:

```text
node app/smoke.mjs                                      exit 0
node app/live-auth-smoke.mjs                            exit 0
bash supabase/tests/verify_operational_backend_safety.sh exit 0
git diff --check                                        exit 0
```

The safety verifier confirmed all destructive-database gates reject missing credentials/reset acknowledgement with exit 2 and then reported:

```text
Safety verifier passed: gate rejects unsafe conditions.
```

## Self-review

- Migration inventory: only `20260829000007_notification_destinations.sql` was added.
- Explicit destinations beginning `#/` return unchanged before resolver invocation.
- Booking candidates use the required timestamp (`reserved_at` or `paid_at`), a ±5-second window, `profile_id`, and `count(*) = 1`.
- Deferral candidates additionally require non-null `deferred_from_booking_id`.
- Session routes require one timestamp-matched session; member no-defer matching also requires a profile-owned booking relation.
- Zero/multiple candidates return null; notification body text is never read.
- Backfill assigns only `destination`, excludes valid explicit routes, and resolves only non-null results.
- Migration declares no producer replacement and no notification RLS or table-grant change.

## Unavailable / concerns

- `bash supabase/tests/verify_operational_backend.sh`: not run; disposable Supabase-compatible credentials and `psql` are unavailable.
- SQL syntax/runtime and deployment remain unverified against PostgreSQL/Supabase.
- Migration `00007` has not been applied to any remote database.
