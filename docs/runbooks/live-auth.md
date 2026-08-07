# Live Auth — Operational Runbook

This runbook covers the combined Testing candidate's live Supabase Auth,
identity, notifications, Giving, Admin, and approval workflows.

## Candidate ownership and surfaces

- **Supabase owns:** identity, roles, applications, notifications, Giving
  campaigns, and donor profiles.
- **`localStorage` owns:** Payment operations and Community prototype
  interactions. Reservations, bookings, queues, collector duty, payout details,
  confirmations, receipts, and prototype donation records remain device-local
  and are keyed by the authenticated Supabase profile UUID.
- **Navigation:** Notification bell plus a signed-in-only Giving tab.
- **Admin tabs:** Approvals, Members, Activities, Giving, and Payments / Ops.
  Each Admin route exposes exactly one active tab.
- **State compatibility:** the current local state is v13; v9, v10, v11, and
  v12 persisted snapshots are accepted and migrated while preserving genuine
  records.

Pending and declined profiles can browse public surfaces but cannot render or
invoke Payment reservation, queue, or pay controls, and cannot use Giving
transfer controls. Signing out clears the Supabase session but preserves the
UUID-owned device-local Payment records.

## Vercel env vars

Set in the Vercel project settings → Environment Variables:

- `SUPABASE_URL` — the project URL (e.g. `https://xyz.supabase.co`).
- `SUPABASE_ANON_KEY` — the project's anon key, safe to ship to the browser.

After updating env vars, redeploy. The placeholder values in `app/index.html`
are only used when no env vars are injected.

## Google OAuth redirect URL

The prototype requests the callback with:

```js
`${location.origin}${location.pathname}`
```

In Supabase Dashboard → Authentication → URL Configuration → Redirect URLs,
add the exact deployed Testing candidate URL ending in `/app/`. Preview and
production domains are different origins, so add every deployed URL that will
be tested. The callback must remain the exact origin plus deployed pathname;
a missing or mismatched trailing `/app/` path causes Google to return to an
unapproved URL.

For local OAuth testing, also add `http://127.0.0.1:4173/app/` (and the exact
`localhost` form separately if you use it).

## Local development

Without Supabase configuration, local state starts empty. A membership
application creates a pending local profile that can sign in again by email.
There are no seeded identities or administrative controls in local mode.

For administrative testing, configure Supabase live mode or use the historical
`archive/demo` branch. The archive is demonstration-only and must not be used
as a production source branch.

To use live mode locally, edit `app/index.html`'s inline `<script>` block to set
`window.SUPABASE_URL` and `window.SUPABASE_ANON_KEY` to your dev Supabase
project's values. Refresh the page after changes. Manage live identities in
Supabase Admin; this cleanup does not change the schema or delete live users.

## Initial Super Admin bootstrap

Every OAuth-created profile starts `pending`, including the first profile in a
fresh project. There is no browser or first-user promotion path. After all
migrations have run and the intended owner has signed in once, an operator must
verify that person's identity out of band and promote the **known profile UUID**
from the Supabase SQL editor or another **trusted SQL** / service-role context.
Never run this with an UUID learned only from an unverified signup request.

Replace both placeholders below, then run the whole block as one transaction.
It requires the `role_changes` audit migration to be installed, requires an
exact pending UUID/email match, and labels the trigger-created audit row:

```sql
begin;

do $$
declare
  target_id uuid := '<known-profile-uuid>';
  target_email text := '<verified-owner-email>';
  changed_rows integer;
  audit_id uuid;
begin
  update public.profiles
     set role = 'super_admin'
   where id = target_id
     and email = target_email
     and role = 'pending';
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise exception 'bootstrap target must be one verified pending profile';
  end if;

  select id into audit_id
    from public.role_changes
   where profile_id = target_id
     and old_role = 'pending'
     and new_role = 'super_admin'
   order by created_at desc
   limit 1;
  if audit_id is null then
    raise exception 'Initial Super Admin bootstrap audit row missing';
  end if;

  update public.role_changes
     set reason = 'Initial Super Admin bootstrap via trusted deployment SQL'
   where id = audit_id;
end $$;

commit;
```

Verify the result and audit evidence before enabling general sign-in:

```sql
select id, email, role from public.profiles where id = '<known-profile-uuid>';
select profile_id, old_role, new_role, reason, created_at
  from public.role_changes
 where profile_id = '<known-profile-uuid>'
 order by created_at desc;
```

Runtime authorization never hardcodes an owner email. Existing deployments
should verify their intended owner directly in `public.profiles`. If disaster
recovery requires a role correction, make it explicitly in trusted context and
verify the audit trail. Do not add email-based role logic to browser code.

## Promote a second admin

Two paths:

- Via the admin panel: a super_admin signs in → `/admin/members` → find the
  member → **Promote to admin**. The DB trigger logs the change in
  `role_changes` automatically.
- Via SQL (when no super_admin exists yet):

```sql
update public.profiles
   set role = 'admin'
 where email = '<email>';
```

## Backfill profiles

If the trigger is added after some users already exist, run once:

```sql
insert into public.profiles (id, email, full_name, avatar_url, role)
select u.id, u.email,
       u.raw_user_meta_data->>'full_name',
       u.raw_user_meta_data->>'avatar_url',
       'pending'
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);
```

## Inspect audit log

```sql
select p.email, rc.old_role, rc.new_role, rc.reason, rc.created_at
from public.role_changes rc
join public.profiles p on p.id = rc.profile_id
order by rc.created_at desc;
```

## Inspect pending applications

```sql
select p.email, a.mobile, a.date_of_birth, a.is_minor, a.submitted_at
from public.applications a
join public.profiles p on p.id = a.profile_id
where p.role = 'pending'
order by a.submitted_at;
```

## Tear down and reseed the local project

```bash
supabase db reset                 # drops everything; replays migrations
supabase db push                  # pushes migrations to remote
```

## Edit placeholder copy

Until the ITC leadership workshop fills in the policy text, placeholder
copy lives in:

- `app/js/views.js` — `applyFormHtml()` (waiver / privacy / guidelines
  checkbox labels).
- `supabase/migrations/20260804000002_audit_notifications.sql` — the
  welcome notification title and body inside `record_role_change()`.

To update the welcome notification on already-deployed databases:

```sql
update public.notifications
   set body = '<new body text>'
 where kind = 'welcome' and read_at is null;
```

## Migrations

All schema lives in `supabase/migrations/` and is replayed in order by
`supabase db push`. Never edit a migration after it has been applied to
a shared environment — add a new one instead.

## ⏳ Awaiting ITC leadership workshop

The following copy is placeholdered until the workshop lands:

- Waiver acceptance text.
- Privacy policy text.
- Community guidelines text.
- Welcome notification body.
- Approval criteria wording (plausible, non-abusive).
- Hong Kong phone regex in `app/js/store.js` `saveMyApplication`.

The data model supports the real text from day one. Updating the text is
a small SQL or HTML edit per the Edit-placeholder-copy section above.