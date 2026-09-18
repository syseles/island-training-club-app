# Live Auth — Operational Runbook

This runbook covers the combined Testing candidate's live Supabase Auth,
identity, notifications, Giving, Admin, and approval workflows.

## Candidate ownership and surfaces

- **Supabase owns in configured live mode:** identity, roles, applications,
  notifications, Giving campaigns, donor profiles, and the full operational
  workflow: activity templates, dated sessions, paid/RSVP bookings, queue
  entries, receipts, collector duty, payout profiles, and gym finalization.
  Browser mutations route through scoped SECURITY DEFINER RPCs. Realtime
  invalidates authorized rows and identity-free RSVP totals; an assigned
  collector's foreign payout row is refreshed through its narrow RPC on
  Payment route entry and tab restore because payout-table RLS can suppress
  that Realtime event.
- **`localStorage` owns:** local-mode prototype state plus device-local
  Community interactions and application drafts. Live payout saves may cache
  the UUID-keyed handoff details on that device only after Supabase settles;
  forced operational hydration remains authoritative.
- **Navigation:** Notification bell plus a signed-in-only Giving tab.
- **Admin tabs:** Approvals, Members, Activities, Giving, and Payments.
  Dated controls appear under **Activities → Weekly Event Controls**, split
  into Free & RSVP Events and Paid Sessions. Each Admin route exposes exactly
  one active tab.
- **State compatibility:** the current local state is v16; v9 through v15
  persisted snapshots are accepted and migrated while preserving genuine
  records.

Pending and declined profiles can browse public surfaces but cannot render or
invoke Payment reservation, queue, or pay controls, and cannot use Giving
transfer controls. Signing out clears the Supabase session while leaving only
prototype-local drafts/interactions and any post-settlement payout handoff
cache on the device; authoritative live operational rows remain in Supabase.

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
4. Configure every exact authentication redirect URL as described below,
   including the deployed `/app/` path.
5. Serve the candidate locally, inspect `window.SUPABASE_URL` in the browser,
   sign in to the intended project, and run the smoke suites before committing
   and deploying that exact revision.
6. After Vercel deploys, inspect the served page and repeat a sign-in check on
   the deployed origin. To switch projects, update `app/index.html`, review the
   diff for anon values only, and redeploy; changing Vercel env vars is not a
   substitute.

For localStorage-only operation, set both assignments to empty strings in a
local, uncommitted copy.

## Authentication redirect URLs

Google OAuth and email magic links request the callback with the exact deployed
origin and pathname:

```js
`${location.origin}${location.pathname}`
```

In Supabase Dashboard → Authentication → URL Configuration → Redirect URLs,
add the exact deployed Testing candidate URL ending in `/app/`. Preview and
production domains are different origins, so add every deployed URL that will
be tested. A missing or mismatched trailing `/app/` path causes an OAuth or
magic-link callback to return to an unapproved URL.

For local authentication testing, also add `http://127.0.0.1:4173/app/` (and
the exact `localhost` form separately if you use it).

## Email magic links and custom SMTP

Google remains the primary sign-in button. Email magic links are the secondary
path for members without Google accounts. Supabase Auth creates and verifies
the token. Until ITC owns a domain, Gmail SMTP delivers it from the approved
interim operational account.

Interim launch configuration:

1. Enable the Email provider in Supabase Authentication settings. Leave new
   user creation enabled: the database trigger creates a `pending` profile,
   never an approved member.
2. Use sender name **Island Training Club** and sender email
   `itc.admin.ops@gmail.com`. This shared mailbox also handles approved admin
   operations, payments, and enquiries; its wider blast radius is accepted
   temporarily until ITC owns a domain.
3. Enable two-step verification on the Google account and generate a dedicated
   Google App Password labelled for Supabase SMTP. Do not use the account's
   ordinary Google password.
4. In Supabase custom SMTP settings, configure:
   - host: `smtp.gmail.com`;
   - port: `465` with SSL or `587` with STARTTLS, according to the dashboard;
   - username/sender email: `itc.admin.ops@gmail.com`;
   - password: the dedicated Google App Password;
   - sender name: `Island Training Club`.
5. Keep the App Password only in Supabase project settings. Never add it to
   `app/index.html`, Git, browser storage, client JavaScript, screenshots, or
   this runbook. Preserve Google recovery methods and backup codes separately.
6. Add the exact local, preview, and production `/app/` URLs to Supabase's
   redirect allowlist. Magic links use the same exact callback path as Google.
7. Set the Email OTP expiry to exactly `900` seconds so the configured lifetime
   matches the 15-minute security statement in the branded templates. Configure
   Supabase request throttling as well. The browser already suppresses duplicate
   in-flight submissions; Gmail/Supabase limits remain the authoritative abuse
   control.
8. Use the account only for its approved low-volume operations and
   authentication. Do not use it for newsletters or bulk marketing. Monitor
   Gmail quota, throttling, bounces, and delivery failures; free Gmail SMTP is
   not a transactional-delivery guarantee.

### Branded template deployment

The email-safe Night Circuit bodies, exact subjects, and acceptance checklist
are in `supabase/email-templates/README.md`. The two templates deliberately
have different messages:

- **Confirm signup** explains that email confirmation continues an application
  and does not grant membership approval.
- **Magic Link** provides secure returning-account access without a password.

Both templates load the optimized approved logo from an immutable public GitHub
asset URL pinned in their HTML. This avoids depending on an unpromoted Vercel
build. Verify the URL returns `image/png` without authentication before pasting
the templates into Supabase. Move the asset to an ITC-owned public host when one
is available. Keep `{{ .ConfirmationURL }}` unchanged.

When ITC owns a domain, replace this interim sender with a dedicated domain
address through a transactional provider and configure SPF, DKIM, and DMARC.

The browser always responds with generic copy — **Check your inbox** on success
or a generic retry message on failure — and never says whether an address was
already registered. Phase one supports opening the link on the same device
that requested it. If a link has expired or was already used, return to Account
and request a new one. Cross-device callback behavior must be recorded during
deployment acceptance; a numeric email-code fallback is not implemented.

Before production enablement, test identity continuity against the actual
Supabase project in both directions:

1. Sign in with Google, record the `auth.users.id`, role, bookings, and receipts,
   then request a magic link for the same exact verified email. All values must
   remain attached to the original UUID.
2. Create a magic-link identity first, record its UUID, then sign in with Google
   using the same exact verified email. The UUID must remain unchanged.

A Gmail alias, `+tag`, work address, or other different address is a separate
identity. Do not normalize or merge it in browser code. If the same exact email
produces a second UUID in either acceptance test, block rollout and correct the
Supabase identity-linking/provider configuration before continuing.

Production acceptance also covers branded inbox delivery, spam placement,
expired and reused links, rate limits, and current Safari/iOS, Chrome/Android,
and desktop Chrome. Zero-cost Gmail SMTP is an interim expectation, not a
permanent availability or delivery guarantee.

Rollback is configuration-first: disable the Supabase Email provider, then
remove the email form in a follow-up deploy. Google OAuth remains available.
Do not delete identities, profiles, applications, bookings, or receipts during
rollback.

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

## Profile photos: deployment, acceptance, and rollback

Profile photos are a live-Supabase feature. Local mode always renders initials:
it does not upload, persist, or place image bytes/base64 data in `localStorage`.
Approved members, Admins, and Super Admins may manage photos. Public, pending,
and declined viewers cannot resolve other members' photos.

### Pre-deployment checks and secrets

1. Select the intended Supabase project and confirm its backup/point-in-time
   recovery status. Do not use a production database for the destructive test
   harness. Set and visibly verify the public project reference, then inspect
   both local and remote migration history before any write:

   ```bash
   export SUPABASE_PROJECT_REF="<confirmed-project-ref>"
   supabase projects list
   supabase migration list --project-ref "$SUPABASE_PROJECT_REF"
   supabase db push --dry-run --project-ref "$SUPABASE_PROJECT_REF"
   ```

   `supabase/config.toml` is versioned so the CLI discovers local migrations
   and each function's shared `supabase/functions/deno.json` import map. If the
   dry run reports no migrations while local files exist, stop: the CLI is not
   reading the repository configuration.
2. In Supabase Dashboard → Edge Functions → Secrets, confirm the managed
   `SUPABASE_SERVICE_ROLE_KEY` is available to functions. Never copy its value
   into the browser, Vercel, logs, screenshots, this runbook, or any repository
   file.
3. Configure `ITC_APP_ORIGINS` as a comma-separated list of exact allowed
   origins, with no paths and no wildcard. Include each deployed preview/test
   origin that is intentionally supported and, only when needed, the exact
   local origin such as `http://127.0.0.1:4173`. Use the Dashboard secret editor
   or a placeholder command locally; never commit the real list:

   ```bash
   supabase secrets set ITC_APP_ORIGINS="<exact-origin-1>,<exact-origin-2>"
   supabase secrets list
   ```

4. Confirm the deployed frontend contains only the browser-safe Supabase URL
   and anon/publishable key. Search the deployment output for service-role and
   database credentials before continuing.

### Deploy in order

The migration `20260917000001_profile_avatars.sql` creates the private
`profile-avatars` bucket, metadata and immutable audit tables, upload-attempt
rate enforcement, and service-only transition functions. When local and remote
migration histories align, deploy in this exact order:

```bash
supabase db push --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy process-profile-avatar --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy resolve-profile-avatars --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy moderate-profile-avatar --project-ref "$SUPABASE_PROJECT_REF"
```

The production project had a legacy migration-history gap before the avatar
rollout on 18 September 2026: its existing schema was present while older
migration-history rows were absent. An unqualified `db push` would therefore
try to replay old migrations. For that verified condition only, the avatar
migration was applied and recorded explicitly:

```bash
supabase db query --linked --project-ref "$SUPABASE_PROJECT_REF" \
  --file supabase/migrations/20260917000001_profile_avatars.sql
# Verify the bucket, tables, RLS, grants, and functions before recording it.
supabase migration repair 20260917000001 --status applied --linked \
  --project-ref "$SUPABASE_PROJECT_REF" --yes
```

Do not use `--include-all`, and do not mark older versions applied without a
separate schema audit. Reconcile that historical drift before the next normal
migration rollout.

Do not deploy the photo-enabled frontend until all four commands succeed. Edge
Functions accept CORS only from `ITC_APP_ORIGINS`; they must never return
`Access-Control-Allow-Origin: *`. Browser code has no direct Storage mutation
policy. Sanitized objects are delivered through signed URLs valid for 600 seconds
and cached only in page memory.

### Post-deployment verification

Verify the bucket in Dashboard → Storage and with trusted SQL:

```sql
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'profile-avatars';
```

Expected: one row, `public = false`, `file_size_limit = 2097152`, and only
`image/jpeg`. Confirm anon/authenticated users have no direct insert, update,
or delete policy for this bucket. A direct browser Storage upload/delete must
fail; only the three Edge Functions may own object paths.

Before live acceptance, run all automated checks from the repository root:

```bash
node app/avatar-smoke.mjs
node app/smoke.mjs
node app/live-auth-smoke.mjs
deno test --config supabase/functions/deno.json --allow-net supabase/functions/_shared/*_test.ts \
  supabase/functions/process-profile-avatar/index_test.ts \
  supabase/functions/resolve-profile-avatars/index_test.ts \
  supabase/functions/moderate-profile-avatar/index_test.ts
bash supabase/tests/verify_profile_avatars_safety.sh
```

When an explicitly disposable, empty Supabase-compatible database is available,
run the destructive migration integration suite. The acknowledgement flag is a
safety boundary, not boilerplate:

```bash
ITC_AVATAR_TEST_DATABASE_URL="$DISPOSABLE_DATABASE_URL" \
ITC_ALLOW_DATABASE_RESET=1 \
bash supabase/tests/verify_profile_avatars.sh
```

If no acknowledged disposable database is available, record this check as
**unexecuted deployment acceptance**. Never report it as passing, and never
point it at production, staging, a shared database, or a database containing
users/application objects.

Use separate approved Google and email magic-link accounts, plus pending,
declined, Admin, and Super Admin accounts, for browser acceptance:

1. On current Safari/iOS and Chrome/Android, tap the approved Profile avatar.
   Confirm the standard picker offers camera and photo library where supported;
   it must not force camera-only capture.
2. Select JPEG, PNG, and WebP sources. Drag the square crop with pointer/touch,
   zoom from 1–4×, move it with arrow keys, and save. Confirm progress copy,
   duplicate-submit disabling, a 512×512 JPEG result, and Profile/top-navigation
   updates without a page reload.
3. Confirm a verified Google account photo appears automatically when no custom
   image exists. Remove a custom photo and verify Google fallback, or initials
   for a magic-link account without Google imagery.
4. Confirm approved Activity Details shows only confirmed attendee avatar/name
   rows. Signed-out, pending, and declined sessions must retain the member-only
   gate and receive no cross-member image URLs.
5. As Admin and Super Admin, hide an active photo with a required reason. Upload
   a replacement as that moderated member, verify it remains pending, then test
   approve and reject (with reason) independently. Ordinary members must never
   see moderation controls or pending previews.
6. Let a signed URL expire or deliberately break an image request. Confirm the
   initials sibling appears without exposing an object path or server error.
7. Test 375 px portrait and a narrow landscape viewport. Confirm attendee rows,
   review cards, dialogs, focus order, Escape close, focus restoration, and
   reduced-motion behavior remain usable.
8. Download one processed object through a temporary signed URL in trusted
   Admin context. Verify exact 512×512 JPEG dimensions and no EXIF/GPS/comment
   metadata. Do not retain the downloaded member image after the check.

### Storage and audit cleanup checks

After upload replacement, custom removal, Admin rejection, and a forced failed
transition, inspect metadata/audit rows and look for unreferenced objects:

```sql
select profile_id, state, moderated_by, moderation_reason, moderated_at
  from public.profile_avatars
 order by updated_at desc;

select profile_id, actor_id, action, reason, created_at
  from public.profile_avatar_audit
 order by created_at desc
 limit 100;

select o.name, o.created_at
  from storage.objects o
  left join public.profile_avatars p
    on o.name in (p.google_object_path, p.active_object_path, p.pending_object_path)
 where o.bucket_id = 'profile-avatars'
   and p.profile_id is null
 order by o.created_at;
```

The audit should show attempts and transitions without image bytes. Investigate
recent in-flight objects before removal. Delete only confirmed stale objects
through trusted operator tooling after the retention decision; never add a
browser cleanup policy.

### Rollback

Treat rollback as an access shutdown first and data cleanup second:

1. Deploy a frontend revision that removes/disables photo upload, attendee
   resolution, and Admin moderation entry points. Confirm clients no longer call
   any avatar function.
2. Disable or delete `process-profile-avatar`, `resolve-profile-avatars`, and
   `moderate-profile-avatar` in the target project. Removing
   `ITC_APP_ORIGINS` alone is not a substitute for disabling function access.
3. Confirm no browser/function requests remain. Preserve the private bucket,
   metadata, and immutable audit rows while leadership decides retention and
   member-notification obligations.
4. If deletion is approved, export the required audit evidence, delete bucket
   objects with trusted service-side tooling, and only then remove the empty
   `profile-avatars` bucket. Verify the object count is zero.
5. Database migrations are append-only. Do not edit or delete the applied
   `20260917000001_profile_avatars.sql` file. Create and review a new rollback
   migration to revoke/drop avatar RPCs and tables only after object cleanup and
   retention approval. Re-run the complete smoke and SQL safety suites.

For a code-only rollback, stop after steps 1–3 and leave private data in place;
this is safer and reversible. Never drop metadata first, because doing so loses
references needed to identify and clean stored objects safely.

## Giving schema and campaign

The member route treats PostgREST `PGRST205` as no active campaign so Giving
remains reachable. This does not make donations functional.

To enable Giving:

1. Apply the ordered migration chain, including
   `20260805000011_giving_campaigns.sql`, `20260806000001_donor_id.sql`, and
   `20260827000001_hyrox_indemnity_fields.sql`, to the intended Supabase
   project.
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

```bash
bash supabase/tests/verify_giving_campaigns.sh --safety-check-only
bash supabase/tests/verify_giving_campaigns_safety.sh
```

## Free-event venue overrides

Dated free/RSVP venues (`wnt`, `run`, `water`, `lunch`) live in
`operational_session_venue_overrides` and use
`set_session_venue(p_session_id text, p_location text, p_maps_query text,
p_was_tbc boolean, p_meeting_lat double precision, p_meeting_lng double
precision)`. The four-argument compatibility wrapper remains available. The
RPC is the only mutation path. Paid HYROX sessions are rejected with
`Activity venue is fixed.`. Members see the first confirmation per session;
Admins see an audit notification on every actual save/reset, excluding the
actor.

The Admin UI exposes these dated controls at **Admin Tools → Activities →
Weekly Event Controls → Free & RSVP Events**. Paid time, venue-status, notice,
and cancellation controls are in the adjacent **Paid Sessions** group.

Recurring Swimming and lunch may remain `TBC` in their activity templates.
Only dated overrides are shared through `set_session_venue`.

Mapping privacy: Nominatim receives the venue text submitted for geocoding and
the browser's IP address. The browser cache is device-local and stores only
venue coordinates; it does not contain member or attendance data.

Deploy the location updates after the operational backend chain in this order:

1. `20260813000001_free_event_venue_overrides.sql`
2. `20260813000002_midtown28_fitness.sql`

Then verify against a fresh disposable database:

```bash
export ITC_OPERATIONS_TEST_DATABASE_URL='postgresql://...disposable database...'
export ITC_ALLOW_DATABASE_RESET=1
bash supabase/tests/verify_operational_backend.sh
```

If `set_session_venue` returns `Could not find 'public.operational_session_venue_overrides' in the schema cache` even though the migration was applied, reload PostgREST's schema cache for the calling role:

```sql
notify pgrst, 'reload schema';
```

Run it once per Supabase role (`anon`, `authenticated`, `service_role`) the
client uses. After this the new table is visible to the PostgREST query path.
Run it via the Supabase SQL editor or `psql` against the live database URL.

Browser-level acceptance on the deployed environment:

1. As an Admin, sign in and open **Admin Tools → Activities → Weekly Event
   Controls → Free & RSVP Events**. Save a dated display location and geocode
   query.
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

Applying the migrations to the real remote target remains a manual deployment
operation; confirm the selected project and backups before running
`supabase db push`.

## Initial Super Admin bootstrap

Every Supabase Auth-created profile starts `pending`, including the first profile in a
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

- Google OAuth or email magic-link authentication creates `public.profiles(role = 'pending')`. Until an `applications` row exists, Admin shows the profile under **Awaiting application** and approval controls remain locked.
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

`20260827000001_hyrox_indemnity_fields.sql` is additive: it adds
`waiver_signature_text`, `waiver_signed_at`, `waiver_form_version`, and
`emergency_relationship` to `public.applications` without backfilling or
adding `not null` constraints. Apply it before deploying any UI revision
that writes the versioned indemnity fields so live application submits and
Profile > Indemnity updates do not fail on missing columns.

The latest operational corrections are forward migrations and must remain in
this order after `20260829000008_rsvp_integrity.sql`:

1. `20260830000001_rsvp_count_trigger_locking.sql` narrows RSVP count triggers
   to confirmed contribution changes and serializes exact RSVP recounts with
   per-session advisory transaction locks.
2. `20260830000002_release_operational_reservation.sql` adds the owner/Admin
   RPC for releasing only unmarked paid reservations. It does not perform a
   client-side or fake live waitlist promotion.
3. `20260830000003_notification_event_destinations.sql` corrects notification
   routes for zero-price/RSVP events and preserves the Schedule fallback for
   paid cancellation rows.

`verify_operational_backend.sh` replays the ordered chain and then runs a
bounded concurrency harness. It still requires a fresh, explicitly
acknowledged disposable Supabase-compatible database; a source-only safety
run does not verify PostgreSQL execution.

## ⏳ Awaiting ITC leadership workshop

The supplied Hyrox indemnity source is already implemented. The following copy is still placeholdered until the workshop lands:

- Privacy policy text.
- Community guidelines text.
- Welcome notification body.
- Approval criteria wording (plausible, non-abusive).
- Hong Kong phone regex in `app/js/store.js` `saveMyApplication`.

The data model supports the real text from day one. Updating the text is
a small SQL or HTML edit per the Edit-placeholder-copy section above.