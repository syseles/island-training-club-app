# Profile Details, Privacy, and Indemnity Design

Date: 2026-08-05
Branch: `feature/auth-identity`

## Goal

Make signed-in Profile data accurately reflect the member's application while separating read-only summary cards from explicit editing workflows. Fix indemnity confirmation persistence and keep the weekly encouragement private to signed-in users.

## Scope

1. Persist and display application indemnity acceptance.
2. Show the weekly encouragement only after sign-in.
3. Replace the always-editable Membership Details form with summary and edit views.
4. Replace the hardcoded Privacy & Notifications page with application-backed and member-editable values.

No real notifications will be sent. The notification fields are preferences only.

## Routes and UI

### Home

`#/home` displays “Encouragement of the week” only when `store.currentUser()` returns a user. This includes pending, member, admin, and super-admin users. Visitors do not see the card.

### Indemnity

`#/account/indemnity` reads the application's `waiver_accepted_at` value in live mode and the user's `indemnityAcceptedAt` value in local mode.

- When a timestamp exists, the page and Profile row show the confirmed date.
- When no timestamp exists, the page shows the waiver and an “Accept & Confirm” action.
- Successful confirmation persists the timestamp, shows “Indemnity accepted and confirmed,” and immediately rerenders the confirmed state.
- Acceptance captured during the original application counts as confirmation; members are not asked to accept twice.

### Membership Details

`#/account/details` is a read-only summary card with labelled rows for:

- Full name
- Preferred name
- Email
- Member since
- Mobile / WhatsApp number
- Age status: “18 or over” or “Under 18”
- Guardian name and phone when the member is under 18
- Emergency contact name and phone
- How the member heard about ITC
- Optional source detail

An “Update details” button opens `#/account/details/edit`.

The edit page contains a prefilled form for application-owned identity and contact fields: preferred name, mobile, a required “Are you 18 or over?” Yes/No selection, conditional guardian fields, emergency contact, heard source, and heard detail. Selecting No reveals guardian name and phone and makes both required; selecting Yes hides and clears those fields. Google-owned full name and email remain read-only and are not submitted as application fields. Date of birth and photo/video consent are not part of this form.

“Save changes” updates only these membership fields. On success it shows “Membership details saved” and returns to `#/account/details`, which reloads and displays the saved values. On failure it stays on the edit page and shows an error toast without navigating away.

### Privacy & Notifications

`#/account/privacy` is a read-only summary card with labelled rows for:

- Photo/video consent — follows `applications.photo_consent`
- Privacy policy — read-only accepted date from `applications.privacy_accepted_at`
- WhatsApp reminders — Off by default
- Email receipts — Off by default
- Community news — Off by default

An “Update details” button opens `#/account/privacy/edit`.

The edit page allows changes to photo/video consent and the three notification preferences. Privacy-policy acceptance remains a dated, read-only record. “Save changes” updates only these editable fields. On success it shows “Privacy preferences saved” and returns to `#/account/privacy`. On failure it stays on the form and shows an error toast.

## Data Model

### Supabase

Add a new migration that:

- Adds `whatsapp_reminders boolean not null default false`.
- Adds `email_receipts boolean not null default false`.
- Adds `community_news boolean not null default false`.
- Converts each existing `date_of_birth` into the equivalent current `is_minor` value: a person whose eighteenth birthday has passed is 18 or over; otherwise they are under 18.
- Clears existing `date_of_birth` values and removes that column's `not null` requirement. New and updated applications store `date_of_birth` as null and use `is_minor` as the age-status record.

Existing application rows receive `false` for the three preferences through the defaults. Existing RLS policies continue to control member access to their own application row.

### Local prototype

Bump `STATE_VERSION` and add a migration that initializes the same three preferences to `false` for every local user that lacks them. The local user record remains the prototype equivalent of an application: `mediaConsent` supplies photo/video consent, `privacyAcceptedAt` records privacy acceptance, and `isMinor` stores the required age selection. Existing local demo applicants are adults and are backfilled with `isMinor: false` and `privacyAcceptedAt` equal to `appliedAt`; new local applications record both values at submission. Seed data remains read-only.

### Store API

Use focused actions rather than reusing full application submission:

- Read the current application for live summary/edit pages.
- Update only membership/contact application fields.
- Update only photo/video and notification preferences.
- Persist indemnity acceptance without rewriting unrelated timestamps.

Local actions update the equivalent user fields and save through the existing localStorage seam. Live actions update only the selected Supabase columns. Saving Profile edits must not replace live `waiver_accepted_at`, `privacy_accepted_at`, `guidelines_accepted_at`, or `submitted_at`, nor the equivalent local acceptance timestamps.

Live application data used by Profile must be freshly read after successful updates so the summary cannot display stale values.

## View and Router Boundaries

- `views.js` owns summary cards and prefilled edit forms.
- `app.js` awaits async account views, submits section-specific forms, displays toast feedback, and performs success navigation.
- `store.js` is the only persistence boundary for localStorage and Supabase writes.
- Account routes support the existing section plus an edit segment, producing `#/account/details/edit` and `#/account/privacy/edit` without introducing a new top-level page.

## Validation and Errors

- Required membership fields use existing browser validity checks.
- The age question requires an explicit Yes or No; no unselected state can be submitted.
- Choosing “No” makes guardian name and phone visible and required. Choosing “Yes” hides and clears them.
- Failed Supabase reads or writes show an error toast and do not falsely navigate or claim success.
- In live mode, only pending users missing an application redirect to the application flow. Approved, admin, and super-admin users missing an application never redirect to `#/apply`; application-dependent Profile sections render a clear “Application details unavailable” card and must not render fabricated details, edit forms, acceptance forms, or an indemnity “To be accepted” status.
- Indemnity acceptance is idempotent; an existing timestamp is preserved.

## Testing

Extend the smoke coverage with behavior-level checks for:

1. Visitors do not see the weekly encouragement; every signed-in status does.
2. Application `waiver_accepted_at` renders as confirmed on Profile and Indemnity.
3. A missing acceptance can be confirmed and immediately renders as confirmed.
4. Membership Details initially renders a card, not an edit form.
5. The edit route is prefilled, excludes date of birth and photo/video consent, saves focused fields, and returns to the summary route.
6. The required age selection reveals and requires guardian fields only for under-18 members.
7. The migration converts existing dates of birth to age status and removes the stored dates.
8. Privacy summary follows application photo/privacy values.
9. Notification preferences default to Off for existing live and local records.
10. Privacy edit persists photo/video and notification preferences and returns to the summary route.
11. Profile edits do not rewrite waiver, privacy, guidelines, or submission timestamps.
12. Existing local product behavior and Supabase auth regressions remain green.
