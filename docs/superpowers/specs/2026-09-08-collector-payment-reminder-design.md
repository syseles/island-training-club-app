# Collector Payment Reminder Design

## Goal
Make Thursday HYROX payment reminders predictable, opt-out capable for members, and actionable for the assigned collector without duplicate notifications.

## Rules

- The live Supabase operational model is authoritative; live mode never falls back to local state.
- The member audience is limited to active, unpaid HYROX reservations (`status = reserved`, `payment_marked_at IS NULL`, not promoted from the waitlist).
- Member HYROX payment reminders default to enabled for existing and new members.
- Members can disable HYROX payment reminders from Profile → Privacy & Notifications.
- The 4 PM HKT member reminder remains idempotent per HYROX cycle.
- The assigned collector receives one separate 4 PM HKT aggregate reminder per cycle, even when no member reminder is sent because members opted out.
- The existing 6 PM HKT collector grace summary remains unchanged.
- At Friday 7 PM HKT, confirmed members with provisional allocations receive one venue-choice reminder.
- At Friday 9 PM HKT, the assigned collector receives one venue-finalization reminder only when allocation or an enabled venue handoff is incomplete.
- Collector notifications expose only aggregate counts and link to Admin → Payments; no member email, phone, queue row, or raw booking data is included.
- Local prototype behavior mirrors the live audience, preference, timing, and idempotency rules.
- Delivery is in-app notification only in this prototype; WhatsApp/email delivery remains out of scope.

## Live schema/API

- Add `applications.hyrox_payment_reminders boolean NOT NULL DEFAULT true`.
- Add `operational_hyrox_cycles.collector_payment_reminder_sent_at timestamptz`.
- Add `operational_hyrox_cycles.venue_choice_reminder_sent_at timestamptz` and `venue_finalization_reminder_sent_at timestamptz`.
- Add `send_hyrox_member_payment_reminders(p_now timestamptz)` as a SECURITY DEFINER RPC for the 4 PM member checkpoint; it locks eligible cycles, inserts only active unpaid-holder notifications, and timestamps the cycle once.
- Add `send_hyrox_collector_payment_reminder(p_now timestamptz)` as a SECURITY DEFINER RPC. It locks eligible cycles, finds the assigned collector, inserts one aggregate notification, and timestamps the cycle only when a collector exists.
- Add `send_hyrox_venue_reminders(p_now timestamptz)` as a SECURITY DEFINER RPC. It sends the Friday member reminder for provisional allocations and the Friday collector reminder only when enabled venue handoff is incomplete.
- Call the member RPC, existing deadline sweep, collector RPC, and venue-reminder RPC from the live operational sweep in that order.
- A `BEFORE INSERT` notification trigger suppresses only `operational_hyrox_payment_reminder` rows for applications with `hyrox_payment_reminders = false`; missing/NULL preferences remain enabled.

## Local prototype API

- Add `hyroxPaymentReminders` to the local user model as enabled by default when absent.
- Add it to local application normalization and privacy preference updates.
- Gate local HYROX member reminders on `user.hyroxPaymentReminders !== false`.
- Add one local aggregate collector notification at the same checkpoint, using the existing `collectorFor` lookup and `admin/payments` destination.
- Add local Friday 7 PM member and Friday 9 PM collector reminders with persisted cycle timestamps.

## UI copy

- Edit checkbox: `HYROX payment reminders`.
- Privacy summary row: `HYROX payment reminders` with `On`/`Off`.
- Supporting copy: `Thursday payment reminders for unpaid HYROX reservations. You can still check payment status in the app.`

## Tests

- Smoke test the new migration markers and preference field.
- Smoke test member opt-out suppresses only the HYROX payment reminder while the cycle remains idempotent.
- Smoke test the collector receives one aggregate reminder at 4 PM and no duplicate on a repeated sweep.
- Smoke test Friday venue reminders target provisional members, incomplete collector handoffs, and suppress the collector reminder after finalization.
- Preserve existing local 6 PM grace summary and 7/8 PM reconciliation tests.
