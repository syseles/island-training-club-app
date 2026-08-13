# Live Auth — Operational Runbook

This runbook covers the combined Testing candidate's live Supabase Auth,
identity, notifications, Giving, Admin, and approval workflows.

## Candidate ownership and surfaces

- **Supabase owns:** identity, roles, applications, notifications, Giving
  campaigns, donor profiles, and the full HYROX operational workflow:
  activity templates, weekly sessions, bookings, queue entries, receipts,
  collector duty, payout profiles, and the gym finalization record. All
  operational mutations route through SECURITY DEFINER RPCs and are
  synchronized across devices via Realtime.
- **`localStorage` owns:** the device-local Community prototype interactions
  (prayer requests, draft applications) and the UUID-keyed collector payout
  profile that the on-duty admin edits locally. Operations state is never
  stored in `localStorage` once live mode is enabled.
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

## Static Vercel configuration

This is a **static no-build deployment**. Vercel serves `app/index.html` as
committed and **does not inject** project environment variables into its inline
script. Setting `SUPABASE_URL` or `SUPABASE_ANON_KEY` in Vercel project settings
alone has no effect on this prototype.

The actual configuration seam is the inline script in `app/index.html`:

```js
window.SUPABASE_URL = "...";
window.SUPABASE_ANON_KEY = "...";
```

Use this safe deployment process:

1. Choose the target Supabase project and apply the ordered migrations. Verify
   RLS and the pending-only profile bootstrap before connecting a public URL.
2. Obtain that project's URL and browser-safe anon/publishable key. Never put a
   `service_role` key, database password, or other secret in HTML, Git, Vercel
   output, or browser storage.
3. Edit only those two assignments in `app/index.html` with the
   **deployment-specific values**. An anon key is public by design; RLS is the
   security boundary. Do not duplicate the values in this runbook.
4. Configure every exact OAuth redirect URL as described below, including the
   deployed `/app/` path.
5. Serve the candidate locally, inspect `window.SUPABASE_URL` in the browser,
   sign in to the intended project, and run the smoke suites before committing
   and deploying that exact revision.
6. After Vercel deploys, inspect the served page and repeat a sign-in check on
   the deployed origin. To switch projects, update `app/index.html`, review the
   diff for anon values only, and redeploy; changing Vercel env vars is not a
   substitute.

For localStorage-only operation, set both assignments to empty strings in a
local, uncommitted copy.

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

## Giving schema and campaign

The member route treats PostgREST `PGRST205` as no active campaign so Giving
remains reachable. This does not make donations functional.

To enable Giving:

1. Apply the ordered migration chain, including
   `20260805000011_giving_campaigns.sql` and `20260806000001_donor_id.sql`, to
   the intended Supabase project.
2. Sign in as an approved Admin or Super Admin and use **Admin Tools → Giving**
   to create and publish a real campaign.
3. Verify the published campaign as an approved member.

No fake campaign data is restored.

Before production deployment, verify the migration chain against a fresh,
disposable Supabase-compatible database:

```bash
export ITC_GIVING_TEST_DATABASE_URL='postgresql://...disposable database...'
export ITC_ALLOW_DATABASE_RESET=1
bash supabase/tests/verify_giving_campaigns.sh
```

This verifier applies every migration and runs SQL integration checks. It is
destructive and must never target production, staging, a shared database, or
any database containing users or application objects. Its safety gate requires
an explicitly acknowledged, empty target. Exercise the gate without applying
migrations with:

## Free-event venue overrides

Weekly free-event venues (`wnt`, `run`, `water`) live in the new
`operational_session_venue_overrides` table and the
`set_session_venue(p_session_id text, p_location text, p_maps_query text,
p_was_tbc boolean)` RPC. The RPC is the only mutation path. HYROX sessions
are rejected with `Activity venue is fixed.`. Members see the first
confirmation per session; Admins see an audit notification on every actual
save/reset, excluding the actor.

Apply the migration after the operational backend chain:

```bash
export ITC_OPERATIONS_TEST_DATABASE_URL='postgresql://...disposable database...'
export ITC_ALLOW_DATABASE_RESET=1
bash supabase/tests/verify_operational_backend.sh
```

Browser-level acceptance on the deployed environment:

1. As an Admin, sign in and open **Admin Tools → Payments / Ops → Free-event
   venues**. Save a dated display location and geocode query.
2. Open the dated activity page with `localStorage.removeItem("itc.geocode.v1")`.
   Confirm the Leaflet marker, attribution, and external Get directions link.
3. Confirm an approved member receives **Venue confirmed** and another Admin
   receives **Session venue updated**. The actor must not receive a duplicate
   notification.
4. Edit and then reset the venue; members are not notified again.
5. Block `unpkg.com` and `nominatim.openstreetmap.org` separately. Both
   failure paths must settle on the fallback copy without breaking the
   external Get directions link.
6. Open both HYROX activity pages. Get directions must appear without a
   weekly venue form.

```bash
bash supabase/tests/verify_giving_campaigns.sh --safety-check-only
bash supabase/tests/verify_giving_campaigns_safety.sh
```

Applying the migrations to the real remote target remains a manual deployment
operation; confirm the selected project and backups before running
`supabase db push`.

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

## Application drafts and approval states

- Google OAuth creates `public.profiles(role = 'pending')`. Until an `applications` row exists, Admin shows the profile under **Awaiting application** and approval controls remain locked.
- The live membership form calls `saveMyApplication()` and upserts `public.applications`. Successful submission moves the profile to **Ready for review**.
- Unfinished forms auto-save every 500 ms to `itc.apply.draft.v1` on that browser only. Drafts are not uploaded to Supabase and do not appear to administrators.
- Home, Account, and Apply expose Continue / Discard controls while a local draft exists.
- A successful Supabase submission or explicit Discard removes the local draft. Sign-out does not remove it.
- To reset a tester's draft without deleting their Supabase identity, run `localStorage.removeItem('itc.apply.draft.v1')` in that browser's console.

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