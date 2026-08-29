# Task 3 Report — Exact Booking reserved payment navigation

## Status

Implemented the Task 3 live-auth regression in `app/live-auth-smoke.mjs` only.
No production files were changed.

The regression uses the live reservation fixture's real `uuidBooking.id` and proves:

- the rendered `Booking reserved` row has exactly `data-destination="#/pay/<booking-id>"`, not either account fallback;
- the delegated unread open completes exactly one `markNotificationRead()` update before navigating;
- the delegated hash is exactly the booking-owned payment route;
- the hashchange renderer accepts the current member's reservation and renders its payment form;
- the now-read row renders with the same exact destination, routes again, and does not issue another read update.

## RED evidence

Three temporary production mutations were applied one at a time, run in fresh Node processes, and restored. None remains in the worktree.

1. Ignoring explicit route precedence for `operational_booking_reserved` made `node app/live-auth-smoke.mjs` exit 1 with:

```text
AssertionError: Booking reserved must render the exact reserved-booking payment route
actual:   '#/account/payments'
expected: '#/pay/b-1'
```

2. Forcing the real `notification-open` delegate to `#/account` made the suite exit 1 with:

```text
AssertionError: the unread reservation notification must navigate to its exact payment route
actual:   '#/account'
expected: '#/pay/b-1'
```

3. Rejecting only the real reservation fixture (`b-1`) at `viewPay()` ownership validation made the suite exit 1 with:

```text
AssertionError: the payment view must accept the current member's reserved booking
```

A broader ownership mutation first failed on an earlier existing ownership regression, so it was restored and narrowed to isolate the new Task 3 assertion.

## GREEN evidence

After restoring the approved production behavior:

```sh
node app/live-auth-smoke.mjs
```

exited 0 and included:

```text
ok  exact Booking reserved notification routes unread and read rows to the owned payment view
```

A production diff guard also passed:

```sh
git diff --exit-code -- app/js/app.js app/js/data.js app/js/views.js
```

## Self-review

- The test derives `action`, notification ID, read state, and destination from the rendered button attributes before invoking the real delegated click listener.
- The exact expected route is independently built from the real reservation fixture ID.
- Literal assertions reject both `#/account` and `#/account/payments` fallbacks.
- The unread path checks the exact update count, updated notification ID, persisted `read_at`, exact hash, and owned payment form.
- The read path rerenders the same mutated notification row, checks `data-notification-read="true"`, proves no second update, and reopens the same payment form.
- The fixture is removed and the Notifications route restored so downstream regressions retain their prior state assumptions.
- `app/js/views.js` and `app/js/app.js` required no changes.

## Verification

Fresh final verification before commit:

```text
node app/smoke.mjs                                      exit 0 — All smoke tests passed
node app/live-auth-smoke.mjs                            exit 0 — exact Booking reserved regression reported ok
bash supabase/tests/verify_operational_backend_safety.sh exit 0 — unsafe conditions rejected
git diff --check                                        exit 0
git status --short --branch                             exit 0 — only the Task 3 test was tracked as modified; this ignored report is force-added
```

## Concerns / unavailable evidence

- Migration `20260829000007_notification_destinations.sql` has **not** been claimed as remotely applied or deployed.
- This Task 3 test proves client rendering and delegated routing against a live-style notification fixture; actual remote live routing still depends on migration `00007` being applied remotely.
- PostgreSQL/Supabase SQL runtime and remote deployment remain outside this task's available evidence.
