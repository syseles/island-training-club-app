# Private Prayer Requests and Profile Subpage UX Design

**Date:** 20 September 2026  
**Status:** Approved for implementation planning

## Context

The Community prayer form currently gives a success message but writes only to the submitting browser's `localStorage`. Members cannot review what they submitted, and Admins cannot see requests anywhere. The statement that requests go privately to ITC leaders is therefore inaccurate in configured live mode.

Several nearby navigation surfaces also repeat hierarchy rather than clarifying it:

- Profile detail pages show both a neon `Profile · …` kicker and the same page title below it.
- Admin Tools has no route back to Profile.
- Schedule repeats free-versus-paid guidance after the session cards already communicate that distinction.

This change makes prayer delivery real and private, then removes the prototype wording and aligns the affected navigation hierarchy.

## Goals

- Accept prayer requests only from approved members, Admins, and Super Admins.
- Store live requests authoritatively in Supabase.
- Let a member review only their own requests.
- Let a member choose whether each request is identified or anonymous to app-level Admins.
- Give Admins and Super Admins a private operational queue.
- Support the agreed `New → Prayed for → Closed` workflow.
- Let members close or withdraw their own active requests.
- Ensure withdrawal clears the request text and removes it from Admin visibility.
- Remove misleading prototype copy and redundant page hierarchy.
- Preserve local-mode parity without uploading historical device-only requests.

## Non-goals

- Public or member-to-member prayer feeds.
- Comments, replies, reactions, or leader notes.
- Email, SMS, WhatsApp, Web Push, or phone sounds.
- Automated content classification or moderation.
- Editing a member's original request.
- Anonymous submissions by visitors, pending applicants, or declined applicants.
- Automatic upload of historical `localStorage` prayer requests.
- Automatic retention expiry or purging of closed requests; a future policy may add this after leadership review.
- A general-purpose case-management or pastoral-care system.

## Confirmed product decisions

- Submission is limited to approved roles: `member`, `admin`, and `super_admin` in Supabase. Browser aliases such as `superadmin` normalize to `super_admin` at the backend seam.
- Identity sharing is per request. The form defaults to identified submission and offers **Hide my identity from ITC leaders**.
- Anonymous means anonymous in the Admin web application, not anonymous to trusted database operators. Supabase must retain `owner_id` to enforce ownership and render the member's private history.
- Admins can change status but cannot alter request wording.
- Members can close or withdraw active requests.
- A withdrawn request retains only minimal metadata; its request text is cleared.
- No automatic notifications are introduced.

## Data model

Add migration `20260921000001_prayer_requests.sql` with `public.prayer_requests`:

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` | Primary key, `gen_random_uuid()` |
| `owner_id` | `uuid` | Required; references `public.profiles(id)` with cascade delete |
| `request_text` | `text` | Required while active/closed; nullable only after withdrawal |
| `anonymous_to_leaders` | `boolean` | Required, default `false` |
| `status` | `text` | `new`, `prayed_for`, `closed`, or `withdrawn` |
| `created_at` | `timestamptz` | Required, server generated |
| `updated_at` | `timestamptz` | Required, server managed |
| `closed_at` | `timestamptz` | Set on close, otherwise null |
| `withdrawn_at` | `timestamptz` | Set on withdrawal, otherwise null |
| `status_changed_by` | `uuid` | Last authenticated actor; references `public.profiles(id)` |

Constraints enforce these invariants:

- trimmed active request text is 1–2,000 characters;
- `withdrawn` rows have `request_text is null` and `withdrawn_at is not null`;
- non-withdrawn rows retain request text and have no withdrawal timestamp;
- only `closed` rows have `closed_at`;
- status values are closed to the four documented states.

Indexes cover `(owner_id, created_at desc)` and `(status, created_at asc)`.

## Trust boundary and RPCs

Enable RLS, revoke direct table privileges from `public`, `anon`, and `authenticated`, and expose only narrowly scoped `security definer` functions with `set search_path = public`. Functions are revoked from `public`/`anon` and granted to `authenticated` only.

Every RPC re-reads `public.profiles` using `auth.uid()`; JWT metadata alone is not authoritative for approval or administrative access.

### `submit_prayer_request(p_request_text text, p_anonymous_to_leaders boolean)`

- Requires an authenticated profile with approved role.
- Trims and validates the request server-side.
- Creates a `new` row owned by `auth.uid()`.
- Returns the member-safe row.

### `list_my_prayer_requests()`

- Requires an approved role.
- Returns only rows where `owner_id = auth.uid()`.
- Includes the member's own request text, anonymity choice, status, and timestamps.
- Returns newest first.

### `set_my_prayer_request_state(p_request_id uuid, p_action text)`

- Locks the owned row.
- Accepts `close` while status is `new` or `prayed_for`.
- Accepts `withdraw` for any non-withdrawn owned request, including a closed request.
- `close` changes status to `closed` and records `closed_at`.
- `withdraw` changes status to `withdrawn`, nulls `request_text`, clears `closed_at`, and records `withdrawn_at` in the same statement.
- Withdrawn rows are immutable through this member RPC.

### `list_admin_prayer_requests()`

- Requires `admin` or `super_admin` from the profile table.
- Returns active and closed requests, ordered with `new` first and oldest active first.
- Excludes withdrawn rows entirely.
- For identified requests, returns the member's display name.
- For anonymous requests, returns `Anonymous member` and does not return `owner_id`, email, or another stable identity field.

### `set_admin_prayer_request_status(p_request_id uuid, p_status text)`

- Requires `admin` or `super_admin`.
- Locks the row and accepts `prayed_for` or `closed` only.
- Permits `new → prayed_for`, `new → closed`, and `prayed_for → closed`.
- Rejects edits to closed or withdrawn requests.
- Never accepts or changes request text, owner, or anonymity.

## Member experience

### Community → Prayer

For visitors, pending applicants, and declined applicants, replace the form with an approved-member gate and a route to Profile/sign-in. Public descriptive prayer copy remains visible.

For approved members:

1. Remove the optional name input. Identity comes from the authenticated profile.
2. Keep a required request textarea with a 2,000-character maximum.
3. Add an unchecked checkbox: **Hide my identity from ITC leaders**.
4. Replace prototype copy with: **Requests are shared privately with ITC Admins and are never posted publicly.**
5. Submit through the authoritative store action. Show success only after the RPC succeeds; retain entered text and show an inline error on failure.
6. Render **My Prayer Requests** below the form.

Each member row shows:

- request text, unless withdrawn;
- `New`, `Prayed for`, `Closed`, or `Withdrawn` status;
- submission date;
- whether it was shared anonymously;
- **Close** while the request is active;
- **Withdraw** on any request that has not already been withdrawn.

Withdrawal requires confirmation because it permanently clears the text. Withdrawn history shows only status and timestamp. Closed request text otherwise remains available to the member and in the Admin closed section until the member withdraws it or a future retention policy is approved.

## Admin experience

Add **Prayer Requests** to the Admin tab row between Activities and Giving.

The page groups requests into:

- **New** — oldest first;
- **Prayed for** — oldest first;
- **Closed** — newest first, collapsed or visually secondary.

Cards show request text, submitted time, status, and either the member display name or **Anonymous member**. Controls are limited to valid next statuses. There is no edit field, owner link for anonymous requests, or withdrawn section.

The Admin root header becomes:

- `← Profile`
- one `Admin Tools` heading
- Admin tabs

The duplicated `Admin` kicker and `Club Operations` title are removed.

## Profile and Schedule hierarchy cleanup

Use one consistent Profile subpage header pattern: a back link followed by one visible `h1`. Remove repeated `Profile · …` kickers.

| Route | Back label | Heading |
|---|---|---|
| Membership Details | Profile | Membership Details |
| Membership Details edit | Membership Details | Edit Membership Details |
| Indemnity | Profile | Indemnity |
| Payments | Profile | Payments & Receipts |
| Privacy | Profile | Privacy & Notifications |
| Privacy edit | Privacy & Notifications | Edit Privacy & Notifications |
| Bookings/history | Profile | Existing title-cased route heading |

The missing-application state follows the same single-heading pattern.

Remove the Schedule footer sentence explaining free versus paid sessions. Session badges, RSVP controls, and activity details remain the source of contextual guidance.

## Store seam and local mode

`app/js/store.js` remains the only browser persistence/backend seam.

Live actions become asynchronous RPC-backed operations:

- `submitPrayerRequest`
- `listMyPrayerRequests`
- `setMyPrayerRequestState`
- `listAdminPrayerRequests`
- `setAdminPrayerRequestStatus`

Local mode mirrors the same role, ownership, redaction, and transition rules in `state.prayers`.

Bump local state from v22 to v23. The v23 migration preserves every historical prayer row and adds defaults:

- `status: "new"`;
- `anonymousToLeaders: false`;
- normalized timestamps and nullable terminal timestamps.

Historical local rows remain on that device and are never sent to Supabase automatically. Existing ownerless local rows are preserved for local administrative inspection but are not attached to a signed-in member history.

## Error handling

- The browser never displays a success toast before the authoritative write settles.
- A failed submission keeps the form contents and shows a plain-language inline error.
- Member and Admin list failures render retryable error states without falling back to another user's or local live-mode data.
- Unauthorized, stale, invalid-transition, and not-found failures are distinguished server-side but reduced to safe user-facing copy.
- Repeated status actions fail safely and never overwrite terminal state.

## Deployment order

1. Add migration safety and rollback-scoped SQL integration tests.
2. Apply `20260921000001_prayer_requests.sql` to an acknowledged disposable Supabase database and run integration tests.
3. Apply and record the reviewed migration on the shared Supabase project without replaying drifted history.
4. Verify table constraints, grants, RLS, function ownership, and RPC behavior.
5. Deploy the controlled Testing frontend.
6. Complete authenticated member/Admin acceptance, including anonymous redaction and withdrawal text clearing.
7. Promote the verified frontend to `main`.

Frontend rollback is safe after the additive migration. Database rollback should disable/revoke RPC entry points before preserving or removing rows according to an explicitly approved data-retention decision; never drop live prayer content casually.

## Testing contract

### JavaScript smoke coverage

- Only approved roles see the form.
- Form copy contains no `Prototype:` language.
- Submission failure retains text and does not show success.
- Member history is owner-only.
- Anonymous choice is visible to the owner.
- Local status transitions match the backend contract.
- Withdrawal clears text and removes the row from local Admin output.
- Admin anonymous rows contain no member identity.
- Admin cannot edit request wording.
- Schedule footer copy is absent.
- Every Profile subpage has one `h1`, no repeated Profile kicker, and the correct back route.
- Admin Tools has `← Profile`, one heading, and the Prayer Requests tab.

### SQL integration coverage

Within a rollback-scoped fixture:

- visitors and pending/declined profiles cannot submit or list;
- approved roles can submit;
- member A cannot list or mutate member B's rows;
- direct authenticated table access fails;
- anonymous Admin output omits stable identity fields;
- identified Admin output shows the display name;
- only Admin/Super Admin can list the Admin queue or change status;
- legal transitions succeed and illegal/repeated transitions fail;
- owners can withdraw active or closed requests;
- withdrawal atomically clears text and disappears from Admin output;
- terminal timestamps and constraints remain consistent.

### Manual acceptance

On current mobile Safari and Chrome:

- submit identified and anonymous requests as an approved member;
- reload and confirm both appear only in that member's history;
- sign in as another member and confirm neither appears;
- verify Admin identity/redaction, status changes, and closed grouping;
- close and withdraw from the member view;
- confirm withdrawn text no longer appears to either member or Admin;
- verify Profile/Admin back behavior and browser back behavior;
- verify headings at 375 px and larger widths without clipping or overlap.

## Acceptance criteria

- No prayer submission claims success unless Supabase accepted it.
- Members see only their own request history.
- App-level Admins cannot identify anonymous requests from returned data or UI markup.
- Withdrawn request text is cleared atomically and not returned through member/Admin RPCs.
- The Admin queue supports the agreed status workflow without content editing.
- Profile subpages and Admin Tools use consistent, non-redundant hierarchy.
- The redundant Schedule footer is removed.
- All automated safety, JavaScript, SQL, syntax, and deployment checks pass before production promotion.
