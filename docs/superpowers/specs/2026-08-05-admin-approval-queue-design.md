# Admin Approval Queue Design

Date: 2026-08-05
Branch: `feature/auth-identity`

## Goal

Make the Admin Approvals tab show every pending profile, clearly distinguish whether an application has been submitted, and support live Approve and Decline decisions for submitted applications.

## Pending Groups

The Approvals tab has exactly two pending groups:

1. **Pending with submitted application** — full application details are shown and Approve/Decline are enabled.
2. **Pending without submitted application** — name and email are shown with “Application not submitted”; Approve/Decline are visible but disabled.

Approved and declined profiles do not appear in Approvals.

## Approval Queue Data Flow

The store builds the live queue profiles-first:

1. Read profiles from Supabase and retain only `role = 'pending'`.
2. Read submitted applications with their profile identity.
3. Match applications to pending profiles by profile ID.
4. Return one queue item per pending profile with `applicationSubmitted: true` or `false`.

This intentionally avoids the current inner-join-only behavior, which drops pending profiles without an application. Local mode maps the existing seeded pending users into the same queue-item shape.

A submitted queue item contains name, email, mobile, emergency contact, heard source, age status, waiver acceptance, photo consent, and submission date. A not-submitted item contains profile identity and no fabricated application values.

If either live query fails, the store throws. The awaited Admin render path catches the error through the existing router error boundary and shows an error toast; the UI must not incorrectly render “No pending applications.”

## Approvals UI

### Submitted application

Render the existing full applicant card with:

- Name and email
- Submitted date
- Mobile
- Emergency contact
- Heard source
- 18-or-over / under-18 status
- Indemnity acceptance
- Photo/video consent
- Enabled Approve button
- Enabled Decline button

### Application not submitted

Render a compact pending card with:

- Name and email
- Pending badge
- “Application not submitted” status
- Supporting copy explaining that the member must finish the application before a decision can be made
- Disabled Approve button
- Disabled Decline button

The disabled state must be represented with actual `disabled` button attributes, not visual styling alone.

## Approve and Decline Behavior

### Approve

Approve changes the profile role from `pending` to `member`. On success, show “Approved.” and rerender the active Approvals tab. The profile disappears from Approvals and appears as an approved member in Members.

### Decline

Decline changes the profile role from `pending` to `declined`. On success, show “Declined.” and rerender the active Approvals tab. The profile disappears from Approvals. When that user signs in, Account renders the existing declined-state screen.

Only submitted applications expose enabled actions. Client-side disabled controls are backed by store validation: a decision action must reject a pending profile without an application.

## Supabase Migration

Create a new migration; do not edit an applied migration.

The migration:

- Replaces the `profiles.role` check constraint so it permits `pending`, `member`, `admin`, `super_admin`, and `declined`.
- Replaces the admin pending-decision update policy so Admin may change a pending profile to `member` or `declined`.
- Keeps Super Admin's existing update permissions.
- Uses `drop ... if exists` where appropriate so a failed SQL Editor attempt can be rerun safely.

The live user adapter maps:

- `pending` role → `status: 'pending'`
- `declined` role → `status: 'declined'`
- `member`, `admin`, and `super_admin` → `status: 'approved'`

The Members tab maps and labels `declined` profiles as Declined rather than approved.

## Store Interfaces

Add or adapt focused store functions:

- `listApprovalCandidates(): Promise<ApprovalCandidate[]>`
  - Returns every pending profile.
  - Includes `applicationSubmitted` and mapped application details.
- `decideApplication(profileId, decision): Promise<void>`
  - `decision` is exactly `member` or `declined`.
  - Verifies the profile is pending and has a submitted application before updating.
  - Local mode uses existing local approval/decline behavior.

Existing generic super-admin role-management behavior remains separate from application decisions.

## Router and UI Boundaries

- `store.js` owns Supabase/local reads, queue merging, validation, and role updates.
- `views.js` renders submitted and not-submitted queue cards.
- `app.js` handles Approve/Decline actions, success/error toasts, and awaited rerendering.
- No real notifications or email are added.

## Error Handling

- Queue read failure: show the database/network error toast and retain the previous rendered screen.
- Invalid decision or unsupported target role: reject without updating.
- Decision for a missing application: reject with “Application not submitted.”
- Failed role update: keep the applicant in the queue and show an error toast.
- Successful decision: toast only after the database update succeeds, then await rerender.

## Testing

Add behavior-level regressions for:

1. Live queue returns pending profiles with and without applications.
2. Pending profiles without applications are no longer omitted.
3. Submitted cards show enabled Approve and Decline.
4. Not-submitted cards show “Application not submitted” and disabled actions.
5. Approved and declined profiles are absent from Approvals.
6. Store rejects decisions for profiles without applications.
7. Approve changes pending to member.
8. Decline changes pending to declined.
9. Declined live users render the declined Account screen.
10. Members labels declined profiles correctly.
11. Query and update errors produce truthful error toasts without false success.
12. Existing local approval behavior and the complete smoke suite remain green.
