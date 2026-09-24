# Web push for operational booking / payment / venue (phase 1)

**Date:** 2026-09-24  
**Status:** Phase 1 — preference + contract only (no service worker, no send path)  
**Branch base:** `main` (non-Shop)

## Decisions

1. **Events (v1):** operational booking, payment, and venue notifications only — not community announcements, giving, welcome, or admin audit rows.
2. **Delivery (v1):** design + schema/prefs now; **defer** Push API service worker, VAPID, subscription store, and Edge/`pg_net` sender until the production host stack is chosen.
3. **Channel gate:** new opt-in `applications.web_push_ops` (default **false**), independent of `whatsapp_reminders`, `email_receipts`, `community_news`, and `hyrox_payment_reminders`.
4. **Inbox remains source of truth.** Future web push mirrors a subset of `public.notifications` inserts; it does not replace in-app notifications.

## Push-eligible kinds (allowlist)

Member-facing operational kinds only:

| Kind | Notes |
|------|--------|
| `operational_booking_reserved` | Booking hold / reserve |
| `operational_rsvp_confirmed` | Free-event RSVP |
| `operational_payment_approved` | Payment confirmed |
| `operational_session_deferred` | Session deferred |
| `operational_session_cancelled` | Session cancelled |
| `operational_session_cancelled_no_defer` | Cancelled without defer |
| `operational_session_venue_updated` | Venue TBC→confirmed / later edits — **shared member rows only** |

**Explicitly out of push scope**

- Admin / ops: `operational_payment_marked`, `operational_gym_finalized`, all `admin_*`, audit-only venue rows
- Community: `community_announcement_*`, giving, welcome
- HYROX cycle-specific kinds (`operational_hyrox_*`) — revisit in a later expansion; not part of this allowlist
- Channel stubs (WhatsApp / email) as delivery mechanisms

Client allowlist constant: `WEB_PUSH_OPS_KINDS` in `app/js/data.js` (documentation + future dispatcher contract).

## Phase 1 deliverables

- Spec (this document)
- Migration: `applications.web_push_ops boolean not null default false`
- Local user field `webPushOps` (default false) + ``STATE_VERSION` bump to 26
- Privacy & Notifications summary + edit checkbox (“Web push for bookings & venue”)
- Wire through `localApplication`, `privacyPatch`, `updateMyPrivacyPreferences`, live hydrate
- Smoke: default off, UI marker, toggle round-trip

## Phase 2 (deferred — production stack)

```text
notifications INSERT (kind ∈ allowlist)
  → join applications.web_push_ops = true
  → look up push_subscriptions for profile_id
  → Edge Function / worker sends Web Push (VAPID)
  → notificationclick opens destination (#/… deep link)
```

Still required later:

- Minimal push-only service worker (no offline cache; AGENTS ban remains for prototype refinement)
- `push_subscriptions` table (`endpoint`, p256dh, auth, profile_id, user agent)
- VAPID key management
- Browser permission UX + iOS Add-to-Home-Screen notes
- Integration test: opted-in member receives send stub; opted-out does not

## Non-goals

- Replacing in-app inbox polling
- Real WhatsApp or email delivery
- Offline / asset-caching service worker
- Shop / merchandise notifications
