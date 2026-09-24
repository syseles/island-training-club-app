# Web push for operational booking / payment / venue

**Date:** 2026-09-24  
**Status:** Phase 2 — live browser Web Push delivery (push-only service worker)  
**Branch:** `feature/web-push-delivery` (off `main`, non-Shop)

## Decisions

1. **Events:** operational booking, payment, and venue shared rows only (`WEB_PUSH_OPS_KINDS`). Venue audit title `Session venue updated` is excluded.
2. **Gate:** `applications.web_push_ops` (opt-in) **and** a row in `push_subscriptions`.
3. **Inbox remains source of truth.** Push mirrors allowlisted inserts; it does not replace in-app notifications.
4. **Service worker:** [`app/push-sw.js`](../../app/push-sw.js) is **push-only** (no offline/asset cache). Explicit exception to the prototype “no service worker” rule for this live channel only.

## Architecture

```text
notifications INSERT (kind/title eligible)
  → applications.web_push_ops
  → push_subscriptions for profile
  → pg_net POST Edge Function send-web-push (x-web-push-secret)
  → VAPID Web Push → OS notification
  → click opens /app/#/…
```

Client: Privacy toggle ON → permission → `PushManager.subscribe` → upsert `push_subscriptions`.  
OFF → unsubscribe + delete rows.

## Phase 1 (already on main)

- Pref column + Privacy UI + allowlist constant + local `STATE_VERSION` 26

## Phase 2 deliverables

- Migration `20260927000001_web_push_delivery.sql`
- Edge Function `send-web-push`
- `app/push-sw.js` + `app/js/web-push.js`
- `window.VAPID_PUBLIC_KEY` in `app/index.html`
- Runbook: [web-push.md](../../runbooks/web-push.md)

## Non-goals

- Offline caching SW  
- WhatsApp / email  
- Community announcement push  
- Local-mode OS notifications  
