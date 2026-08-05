# Visitor Gating & Two-Stage Onboarding — Design

**Date:** 2026-08-05
**Branches:** `feature/auth-identity` (visitor experience + Stage 1 application) and `feature/payment-system` (Stage 2 PayMe reconciliation). Shop stays on `feature/shop-page` — nothing here touches it.
**Status:** Agreed in brainstorm.

## Problem

- Home shows visitors two buttons — "Apply to join" → `#/apply` (a dead end: "Please sign in first") and "Sign in" → `#/account` (the working page). One funnel, two doors, one of them broken.
- Visitors see a "My Week" section on Home, which is meant to be a signed-in-members concept (booked sessions).
- Sign-out drops the user on `#/home` instead of back on the sign-in page.
- Google OAuth verifies identity but gives us no phone number, no "how did you hear about us", and no way to reconcile PayMe/FPS payments — all three still needed.

## Agreed direction

- **Open free tier (Option C):** free sessions are fully public (details, Add to Calendar, Get Directions — they have no booking to gate). Paid/member things funnel through sign-in. Matches the "everyone is welcome — just show up" copy; sign-in is asked at the moment motivation is highest.
- **Two-stage onboarding (Option 2):** Stage 1 = short application immediately after first Google sign-in (what a leader needs to approve). Stage 2 = PayMe reconciliation at first paid checkout (only asked when money moves).
- **PayMe = reconciliation (A):** the club needs to match incoming PayMe/FPS payments to members. PayMe in HK is phone-linked, so the member's phone number is the default reconciliation key; a different number can be saved as an override.

## Section 1 — Visitor experience (`feature/auth-identity`)

**Home (visitor):**

- Remove "My Week" entirely for guests. It is signed-in-only (shows booked sessions), per the existing AGENTS.md contract.
- In its place: **"This week — open to all"** listing upcoming **free** sessions in the same 14-day window `upcomingSessions(14)` already uses, with their real visitor actions (Add to Calendar / Get Directions). Paid sessions do not appear in this section.
- The "New to ITC?" card keeps one **primary button only**: "Continue with Google" → `#/account`. Subcopy: "New here? You'll be guided through a short application after sign-in."

**Routing rules:**

- `#/apply` as a visitor → redirect to `#/account`. The "Please sign in first" wall is deleted.
- **Sign-out → `#/account`** (was `#/home`). The account page *is* the sign-in page for visitors, so signing out lands you where you'd sign back in.
- Schedule tab stays browsable for visitors. Free activity pages: unchanged (fully open). Tapping a **paid** activity as a visitor routes to `#/account` with a "Sign in to book" prompt (replacing the current paid-activity visitor view).

## Section 2 — Stage 1: application after Google sign-in (`feature/auth-identity`)

- First Google sign-in → land directly on `#/apply`.
- Form is **prefilled from Google** (name, email) and shrinks to what Google can't provide:
  - Mobile / WhatsApp number * — `+852 …` placeholder. This is the future PayMe reconciliation key.
  - Emergency contact name * + phone *
  - How did you hear about ITC? (select, unchanged options)
  - Checkboxes: 18+/guardian *, indemnity *, community guidelines *, privacy policy *; photo consent optional
  - Donor ID (optional, unchanged)
- Full name / preferred name / email inputs are removed from the form in live mode (sourced from the Google profile; preferred name can default to first name and stay editable in Profile later).
- Submit → user becomes `pending`; the existing leader-approval flow (admin approves → member) is untouched.
- The existing guard (signed-in pending user with no application → pushed to `#/apply`) already closes the loop and stays.
- **Bootstrap exception:** the first Google sign-in on the live deployment, `syselesli@gmail.com`, becomes `super_admin` (per `docs/runbooks/live-auth.md`). Super admins are never `pending`, so the apply guard never fires for them — they skip Stage 1 entirely and land on the app directly.
- The localStorage (non-live) prototype path keeps its current behavior as the demo seam; changes target the live/auth path and shared visitor views.

## Section 3 — Stage 2: PayMe reconciliation at first checkout (`feature/payment-system`)

Builds on the collector-payments spec (`2026-08-04-hyrox-booking-payment-system-design.md`): the member payment screen already shows the on-duty collector's PayMe paylink / FPS QR.

Add to that screen, at the member's **first paid checkout**:

> **How we'll match your payment**
> ☑ My PayMe/FPS is linked to **+852 XXXX XXXX** *(profile phone, selected by default)*
> ☐ I pay from a different number → [phone input]

- Choice is saved to the member profile as `paymentPhone` (null = same as `phone`).
- Editable later under **Profile → Payments & Receipts**.
- The collector's **pending confirmations** list shows the number to expect each payment from (`paymentPhone ?? phone`), next to the member's name and optional reference note.
- Subsequent checkouts skip the question (shown only until saved once); the saved number is still visible on the payment screen.

## Data model

- `feature/auth-identity`: live-mode profile creation after Google sign-in carries `phone`, `emergencyName`, `emergencyPhone`, `heard`, consents. Bump `STATE_VERSION` with a migration if the persisted local shape changes (never delete keys).
- `feature/payment-system`: member profile gains `paymentPhone` (nullable). Default resolution `paymentPhone ?? phone` happens at render/reconciliation time, not by copying data.

## Testing (`app/smoke.mjs` — updated in the same commits)

- Visitor home: no "My Week" heading; single CTA pointing to `#/account`; "open to all" section lists free sessions.
- `#/apply` as visitor → redirect to `#/account`.
- Free activity (visitor): directions/calendar actions present. Paid activity (visitor) → routes to sign-in.
- Post-sign-in application submit → pending user with phone/heard/emergency contact stored.
- Checkout shows the reconciliation block prefilled with the profile phone on first visit; saved override (`paymentPhone`) is used by the collector confirmations list. *(payment branch)*
- All existing smoke tests keep passing (`node app/smoke.mjs`).

## Non-goals

- No real payments, no real notifications (unchanged prototype stance).
- No Shop / giving / merchandise changes (stays on `feature/shop-page`).
- No changes to the leader approval flow itself.
- "Apply to join" as a separate pre-auth page is deleted, not redesigned — Google sign-in is the single front door.
