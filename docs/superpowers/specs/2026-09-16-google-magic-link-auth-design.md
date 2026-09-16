# Google OAuth + Email Magic-Link Authentication — Design

**Date:** 2026-09-16  
**Branch:** `feature/auth-magic-link`  
**Base:** `origin/testing` at `d47df9f`  
**Status:** Proposed for review

## Problem

The configured live application supports only Google OAuth. That is secure and convenient for members with Google accounts, but it prevents someone who uses another email provider from applying for membership.

ITC needs a second sign-in route that verifies ownership of any deliverable email address without adding passwords or making a phone number the member's identity. Email verification must not grant membership: every new identity must retain the existing `pending` profile and leader-approval workflow.

## Confirmed decisions

- Keep **Continue with Google** as the primary action.
- Add **email magic link** as the secondary action.
- Any valid email may request a link and create an account.
- A new account starts as `pending`, completes the existing membership application, and requires leader approval.
- A magic-link applicant supplies a required full name in the existing membership application.
- Phone numbers remain profile/contact data, not authentication credentials.
- Use a transactional-email free tier at launch; provider credentials and DNS configuration remain deployment configuration, not committed code.

## Goals

- Allow Google and non-Google users to authenticate through Supabase Auth.
- Preserve one member identity when an existing Google user requests a magic link for the same verified email.
- Keep new magic-link identities pending until application submission and Admin approval.
- Collect and save a real full name for identities that do not receive Google profile metadata.
- Provide accessible busy, success, retry, and error states without revealing whether an email was already registered.
- Document free-tier SMTP setup, redirect configuration, limits, and production acceptance checks.
- Preserve localStorage-only prototype behavior when Supabase is not configured.

## Non-goals

- Password authentication.
- Phone/SMS sign-in or SMS two-factor authentication.
- Passkeys or MFA.
- Automatic account merging by similar name, Gmail dot handling, or `+tag` aliases.
- Admin tooling for merging duplicate accounts.
- Bulk email, newsletters, or marketing campaigns.
- A server-side mail service in this repository.
- Changing membership approval criteria or role permissions.
- Changing the existing Supabase schema or historical migrations.

## User experience

### Account page

In configured live mode, the signed-out Account page renders:

1. **Continue with Google** as the primary button.
2. A visually quiet “or continue with email” separator.
3. An email form with:
   - an `email` input using `autocomplete="email"`;
   - an **Email me a sign-in link** submit button;
   - an `aria-live` status/error region.
4. Existing copy explaining that sign-in creates a community-roster entry and that a leader must approve the application before paid booking is available.

The form must not ask for the applicant's name before email verification. New applicants enter their full name after opening the link, as part of the application.

### Home page

The visitor card keeps **Continue with Google** as its primary action and adds a secondary **Use email instead** link to `#/account`. The complete email form remains on Account rather than being duplicated on Home.

### Sending a link

Submitting a valid email:

1. Disables the email input and submit button while the request is pending.
2. Prevents duplicate requests from repeated taps.
3. Calls Supabase `signInWithOtp` with:
   - the trimmed, lower-cased email;
   - `shouldCreateUser: true`;
   - `emailRedirectTo` equal to the exact deployed origin and pathname used by Google OAuth.
4. On success, restores the controls and displays generic confirmation:

   > Check your inbox. We sent a private sign-in link. Open it on this device to continue.

5. Does not say whether the address belonged to an existing member.
6. On failure, restores the controls and displays an actionable generic error. Raw provider errors are not rendered when they could reveal account state; the detailed error may be logged without email tokens or credentials.

The existing Supabase session configuration (`detectSessionInUrl`, persistent sessions, automatic refresh) processes the returned authentication session. The existing deferred `SIGNED_IN` callback then hydrates the profile and redirects a pending user without an application to `#/apply`.

### Application and full name

The live membership application adds a required `full_name` field:

- For Google users, it is prefilled from `profiles.full_name` and may be corrected.
- For magic-link users, it starts empty.
- Device-local application drafts include the field.
- Submission trims and validates the name, updates the signed-in user's `profiles.full_name`, then upserts the existing `applications` row.
- The profile update must not permit changing `role`, `email`, or another user's profile.
- The in-memory live profile/user cache is refreshed after a successful save so Account and Admin views do not continue showing the email as the person's name.

The profile update occurs before application submission. If the application upsert subsequently fails, the harmless name update may remain and the pending applicant can retry. An application must not be created if the profile-name update fails.

## Identity and authorization rules

- The existing `on_auth_user_created` trigger remains unchanged and creates every new profile with `role = 'pending'`.
- Authentication proves control of Google/email identity only; authorization continues to come from `public.profiles.role` and RLS.
- An existing member using a magic link for the exact email associated with their Google identity must retain the same `auth.users.id`, profile role, bookings, receipts, and application.
- A different address or alias is treated as a different identity. The application must not guess that two addresses belong to one person.
- Before production enablement, test both provider orders against the target Supabase project:
  1. Google first, magic link second.
  2. Magic link first, Google second.
- If either order creates two UUIDs for the same exact verified email, production rollout is blocked until the Supabase identity-linking configuration is corrected. This task does not implement an unsafe browser-side merge.

## Email delivery and deployment configuration

Supabase generates and validates the magic link. A custom SMTP provider delivers it.

Recommended launch configuration:

- Use a transactional provider's current free tier, with Resend as the initial candidate.
- Verify an ITC-controlled sending domain.
- Configure SPF and DKIM; enable DMARC monitoring.
- Store SMTP credentials only in Supabase project settings.
- Send from an address such as `noreply@<ITC-domain>`.
- Configure the exact production, preview, and local `/app/` redirect URLs in Supabase.
- Configure a short link lifetime (target: 15 minutes where supported) and a resend/request cooldown.
- Monitor provider quota and delivery failures. Free-tier terms must be checked at deployment because provider limits can change.
- Keep authentication and essential transactional mail within the free allowance; do not use this channel for bulk marketing.

Supabase's default test sender and personal Gmail SMTP are not accepted as the production delivery path. No SMTP API key or password is added to `app/index.html`, Git, browser storage, or client JavaScript.

## Abuse and privacy controls

Initial release uses Supabase/project rate limits plus client-side duplicate suppression and cooldown. CAPTCHA is deferred unless monitoring shows automated abuse; adding it preemptively would add friction to every applicant.

The UI must:

- validate email format before requesting a link;
- use generic post-submit copy;
- avoid logging magic-link tokens;
- avoid logging SMTP credentials;
- never infer membership approval from successful email delivery;
- never expose whether an email already has an account.

## Error and recovery behavior

- **Malformed email:** browser validation keeps focus on the field.
- **Provider/rate-limit failure:** controls recover and the user sees a generic retry message.
- **Expired or used link:** Supabase returns the user without a valid session; Account explains that they should request a new link. Exact callback-error presentation is tested manually against the deployed provider.
- **Link opened on another device:** same-device use is the supported phase-one path. Cross-device behavior is recorded during acceptance testing; a six-digit email-code fallback is a future enhancement if this is a recurring problem.
- **Changed email:** the user signs in with an already-linked provider or asks an ITC administrator for identity recovery. Email-change and account-merge tooling are out of scope.
- **Duplicate alias account:** administrators do not merge records through browser code; resolution is a trusted operational task.

## Code changes

### `app/js/store.js`

- Add `signInWithMagicLink(email)` beside `signInWithGoogle()`.
- Normalize and validate non-empty email input before calling `supabase.auth.signInWithOtp`.
- Use the same exact deployed callback path as Google OAuth.
- Extend `saveMyApplication()` to validate/update `profiles.full_name` before application upsert and refresh the live identity cache.
- Correct the live-mode guard in `signInWithGoogle()` to invoke `isLive()` while touching the same auth boundary.

### `app/js/views.js`

- Render Google first and the magic-link form second in `accountVisitor()`.
- Add the Home **Use email instead** route.
- Add required `full_name` to `applyFormHtml()`, prefilled when available.
- Keep local-mode sign-in and local application behavior unchanged.

### `app/js/app.js`

- Handle `form-magic-link` through existing delegated submit and `withBusyControl` infrastructure.
- Disable both field and submit control while sending.
- Render accessible generic success/error feedback.
- Include `full_name` in the existing live application payload automatically through `FormData`.

### `app/styles.css`

- Reuse existing field, button, muted, and spacing classes. Add only narrowly scoped styling if the separator/status layout cannot be expressed with existing classes.

### `app/live-auth-smoke.mjs`

- Extend the fake Supabase client with controllable `signInWithOtp` behavior.
- Verify normalization, account creation, redirect path, busy state, duplicate suppression, success copy, and failure recovery.
- Verify Account/Home ordering and discoverability.
- Verify the application requires and drafts a full name.
- Verify application submission updates only the current profile's full name before writing the application and refreshes rendered identity.

### `app/smoke.mjs`

- Preserve local-mode behavior.
- Add source/rendering assertions where appropriate for the new live-only seams.

### `docs/runbooks/live-auth.md`

- Add Email provider/custom SMTP configuration.
- Document DNS and redirect requirements, free-tier caveat, test email flow, expiry/retry behavior, identity-continuity acceptance, and rollback.
- Update Google-only wording to Google-or-email wording.

No database migration is expected because `profiles.full_name`, the pending-profile trigger, self-profile update RLS, and the application model already exist.

## Testing and acceptance

Automated verification:

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Manual acceptance on the configured target project:

1. Google sign-in still creates/loads the expected profile.
2. A new non-Google email receives one branded link, returns to `/app/`, becomes `pending`, and is directed to the application.
3. Submitting the application saves the full name and places the applicant in **Ready for review**.
4. An existing approved Google member requests a link for the same email and retains the same UUID, role, bookings, and receipts.
5. A magic-link-first identity later uses Google with the same email and retains the same UUID.
6. Invalid, expired, reused, and rate-limited requests recover without exposing account state.
7. The flow works in current Safari/iOS, Chrome/Android, and desktop Chrome.
8. Local mode still uses the existing device-local email lookup and application flow.
9. SMTP secrets are absent from Git and browser-delivered files.

## Rollout and rollback

Rollout order:

1. Configure and verify the SMTP sending domain.
2. Enable the Supabase Email provider and exact redirect allowlist.
3. Configure email template, lifetime, and rate limits.
4. Deploy the UI/store changes to a preview environment.
5. Complete identity-continuity and browser acceptance tests.
6. Enable the production route and monitor delivery failures/quota.

Rollback is configuration-first: disable the Supabase Email provider and remove the email form in a follow-up deploy. Google OAuth remains available throughout. Existing users and profiles are not deleted during rollback.

## Success criteria

- A person with any functioning email can authenticate and apply without a Google account.
- Google remains the most prominent and unchanged sign-in option.
- New email identities are pending, never automatically approved.
- Full names—not raw emails—appear after application submission.
- Existing members using the same exact email do not lose role or operational history.
- Initial recurring email-delivery cost remains HK$0 under the provider's then-current free tier.
- Both smoke suites pass and deployed identity-continuity acceptance is recorded before production launch.
