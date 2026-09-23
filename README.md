# Island Training Club Web App

This repository contains the product-discovery work, visual directions, and a working interactive prototype for a new Island Training Club community web application.

The current status is pre-production.

No production application has been built yet. The `app/` directory contains a clickable working prototype for refining flows, copy, and visuals — it is not the production implementation, and the production architecture decision remains open.

## Working Prototype

Canonical deployment: <https://island-training-club.vercel.app/>

The prototype implements the selected "Night Circuit" direction and the confirmed product rules from the phase-one brief:

- Free vs paid activity classification everywhere (home, schedule, detail).
- Wednesday Night Training, ITC Run Club, ITC Swimming, and zero-price one-off events remain free, uncapped, and open to walk-ins. Approved members may optionally tap **I’m coming**, withdraw before the Hong Kong start time, and view the member-only attendee roster; there is no checkout, payment, waitlist, or attendance gate.
- Admins manage each dated free/RSVP occurrence independently: expected count, venue/time changes, cancellation with a required reason, and pre-start reopening. Cancellation never defers an RSVP, reopening requires a fresh RSVP, and only the applicable RSVP cohort receives in-app event notifications.
- Island ECC is the only active HYROX session. It keeps the direct HK$180 reservation, waitlist, payment confirmation, receipt, attendance, and manual replacement workflow; Admin replacement confirmation changes only the effective attendee, never the original payer or receipt owner.
- Account lifecycle: public visitor → application → leader approval → member. Pending applicants keep public access only.
- Member area: upcoming bookings, receipts, payment history, profile.
- Approved-member profile photos: private 512×512 sanitized images, manual crop/zoom, verified Google fallback, member-only attendee avatars, and Admin moderation. Local mode remains initials-only.
- Admin area: combined member/application management, activity controls, Giving operations, profile-photo moderation, and Payments with compact, expandable financial-state and waitlist rows plus time-gated paid-session attendance check-in. Island ECC uses the direct paid-session financial roster, waitlist, collector handoff, venue confirmation, attendance, and replacement controls.
- Super Admin can additionally change member roles.

Run it (same server as the design review):

```sh
python3 -m http.server 4173
```

Open:

```text
http://127.0.0.1:4173/app/
```

The design review remains available at `http://127.0.0.1:4173/references/itc-mobile-design-directions.html`.

### Prototype conventions

- Zero dependencies, no build step. Plain ES modules so the codebase stays easy to refine; the production stack is still an open decision.
- The combined Testing candidate has explicit ownership boundaries:
  - **Supabase in configured live mode:** identity, roles, applications, notifications, private prayer requests, Giving campaigns, donor profiles, operational sessions, bookings, queues, collector assignments, payout profiles, confirmations, RSVP totals, receipts, and manual HYROX replacement requests/audit history. Browser mutations use scoped RPCs; no real money is moved. Live prayer submission, history, Admin review, status, and withdrawal are Supabase-authoritative and never fall back to device data after an RPC failure.
  - **`localStorage`:** local-mode prototype state plus device-local Community interactions, application drafts, and the last successfully rendered route for mobile handoff recovery. Historical and newly created local-mode prayer data remains device-only compatibility data; configuring live mode does not upload or merge it automatically. In live mode local storage may retain the identity-scoped route and a UUID-keyed payout handoff cache only after an authoritative Supabase save; forced hydration remains authoritative.
- Navigation combines the Notification bell with a signed-in-only Giving tab. Admin navigation contains Members, Activities, Prayer Requests, Giving, and Payments. Dated free/RSVP and paid session administration is grouped under **Activities → Weekly Event Controls**; Admin → Payments keeps financial reconciliation and time-gated attendance together.
- Persisted prototype state is **v24** and accepts/migrates existing **v9–v23** snapshots without discarding genuine non-pool domain records. The v24 step removes retired pool records from active local state; configured live Supabase remains authoritative.
- With Supabase configured, Google OAuth or email magic-link authentication creates a `pending` profile. The applicant supplies a full name in the membership form and remains pending until an Admin approves it. Pending and declined profiles cannot use Payment or Giving controls. Branded Supabase email bodies and deployment instructions live in `supabase/email-templates/`.
- Without Supabase configuration, local state starts empty. Apply through the membership flow to create a local pending profile, which can then sign in again by email (no password).
- `app/js/store.js` remains the backend seam across both ownership domains until a production backend is selected.
- Static Vercel deployment has no env-injection/build step. Live Supabase browser configuration is set explicitly in `app/index.html`; deployment steps and credential boundaries are documented in `docs/runbooks/live-auth.md`.
- Profile photos use the private Supabase `profile-avatars` bucket through authenticated Edge Functions only. Signed URLs live in memory, never in `localStorage`; follow the [profile-photo deployment, acceptance, and rollback procedure](docs/runbooks/live-auth.md#profile-photos-deployment-acceptance-and-rollback).
- Free-event RSVP live mode uses authoritative recurring operational sessions and scoped RPCs. Apply and verify migration `20260920000001_free_event_rsvp_cancellation.sql` before deploying its frontend; follow the [free-event RSVP deployment and acceptance procedure](docs/runbooks/live-auth.md#free-event-rsvp-cancellation-deployment-and-acceptance).
- Private prayer requests use five scoped Supabase RPCs in live mode; preserved device-only prayer rows remain local-mode compatibility data and are never uploaded automatically. Apply and verify migration `20260921000001_prayer_requests.sql` before deploying its frontend; follow the [private prayer deployment, acceptance, and rollback procedure](docs/runbooks/live-auth.md#private-prayer-requests-deployment-acceptance-and-rollback).
- HYROX pool retirement follows **backend-first deployment**: `00001` already applied once (`20260922000001_retire_bft_midtown_hyrox_pool.sql`). `20260922000002_harden_retired_hyrox_boundary.sql` also already applied once. For the stopped Task 7 run, after reviewed hash/preflight and count-only evidence, apply only `20260922000003_reassert_retired_hyrox_pool_acls.sql`, verify exact pool policies/ACLs including all three retired reminder EXECUTE revocations and unchanged domain rows, bodies and older history, then use separately reviewed one-off recovery before resuming acceptance. Never edit, replay, reapply, or repair `00001` or `00002`; never clear uncertainty or reuse ordinary cleanup-only on the stopped journal. The amended nine-statement 00003 supersedes a never-shared local candidate; review its new hash. Recovery may normalize only independently verified organic generator-session additions, never adopt or delete them; all other baseline domains remain exact. The repaired catalog pin stays `5a0ecdeb48872f4ec2aacebc1d037c14`. Do not repeat the already deployed resolver merely for this ACL repair. For a new deployment, verify helper ACLs, notification least privilege and paid/free rosters, then deploy the reviewed `resolve-profile-avatars` Edge Function after classifier/grant verification, pass direct endpoint gates, then deploy the dependent frontend. Retained BFT/Midtown pool test records are hidden from browser roles, not deleted. A **forward-only rollback** requires a new reviewed migration plus a compatible frontend deployment; applied or historical migrations are never edited. Known retired HYROX deep links render `This session is no longer available.`; unknown IDs keep the existing safe not-found behavior; neither redirects to Island ECC. Follow the [operational backend runbook](docs/runbooks/operational-backend.md#hyrox-pool-retirement-backend-first-deployment).
- Giving's `PGRST205` fallback keeps the member route reachable but does not enable donations. Functional Giving requires the ordered schema migrations and a real campaign published through **Admin Tools → Giving**; follow the [Giving schema and campaign recovery steps](docs/runbooks/live-auth.md#giving-schema-and-campaign). No fake campaign data is restored.
- Administrative testing requires Supabase live mode or the historical `archive/demo` branch. The archive is demonstration-only and must not be used as a production source branch.
- `app/smoke.mjs` is a headless regression check for the product rules (`node smoke.mjs` from `app/`).

### Deliberately not in the prototype

- Merchandise shop (deferred in the phase-one brief).
- Real payments, delivered email receipts, automated booking/reminder delivery by WhatsApp or email, Web Push, phone notification sounds, SMS, and a service worker (manifest is included; a cache layer would fight the refinement loop). Supabase may deliver authentication magic links through configured transactional SMTP. Replacement sharing opens a user-initiated WhatsApp link; live event notifications are in-app only and Supabase-backed when configured.
- Final privacy/guidelines copy and any post-workshop legal/policy revisions. The supplied Hyrox indemnity source is implemented; privacy and guidelines remain provisional.

## Selected Direction

Version 1, “Night Circuit,” is the selected visual direction.

It extends the existing Island Training Club website with a black technical grid, electric-lime accents, documentary community photography, and direct activity actions.

![Selected Night Circuit direction](references/itc-mobile-direction-1.png)

## Review The Designs

Run a static local server from the repository root:

```sh
python3 -m http.server 4173
```

Open:

```text
http://127.0.0.1:4173/references/itc-mobile-design-directions.html
```

The review includes three historical directions with five screens each.

Version 1 is the chosen starting point.

## Product Documents

- [Phase-one product brief](docs/phase-one-product-brief.md)
- [Detailed brainstorming notebook](docs/itc-web-app-product-notes.md)
- [Collaboration handoff](docs/handoff.md)
- [Live Auth operational runbook](docs/runbooks/live-auth.md)
- [Operational backend deployment runbook](docs/runbooks/operational-backend.md)

## Phase-One Summary

- Responsive, mobile-first web application.
- Architecture prepared for later iOS and Android clients.
- Public access to free activities, leaders, and culture.
- Leader approval required for full member access.
- Wednesday Night Training is free and requires no booking.
- Weekly HYROX is a paid, recurring launch activity at Island ECC with direct reservation, payment confirmation, waitlist, attendance, replacement, and receipt management.
- Island ECC is the sole active HYROX product and uses the direct paid-session booking flow at one fixed price.
- PayMe/FPS instructions and in-app payment marking are prototype reconciliation flows, not real payment processing.
- Member, Admin, and Super Admin roles.

## Collaboration

The repository intentionally has no branch-protection requirement.

Authorized collaborators may push directly after they are added to the GitHub repository.

The collaborator’s GitHub username is still needed before access can be granted.
