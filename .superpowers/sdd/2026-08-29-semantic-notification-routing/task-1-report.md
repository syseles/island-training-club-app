# Task 1 Report — Semantic client notification fallbacks

## Status

Implemented the approved client-only semantic section fallbacks in `notificationDestination(kind, destination)`.

- Explicit internal `#/...` destinations still win unchanged.
- Known kinds without an explicit destination route to the exact approved account, schedule, admin, Giving, or account-default sections.
- Unknown kinds and malformed/foreign destinations fall back safely.
- No body parsing or booking/session ID inference was added.
- Delegated mark-read-before-navigation behavior was not changed.
- No Task 2 migration or persisted-state work was started.

## RED evidence

Command:

```sh
node app/smoke.mjs
```

Before changing production code, the new table-driven assertions failed for the missing semantic mappings. Representative failures:

```text
FAIL operational_booking_reserved notification fallback should be #/account/payments
FAIL operational_session_cancelled_no_defer notification fallback should be #/schedule
FAIL operational_payment_marked notification fallback should be #/admin/payments
```

The failures were caused by the existing `#/account` fallback, as expected.

## GREEN evidence

After adding the exact kind-to-section map:

```text
ok  notification destinations use explicit internal routes or stable semantic fallbacks
```

The mapping coverage includes all 18 approved kinds, an explicit `#/pay/booking-123` destination for every kind, malformed/foreign destination rejection, and unknown-kind fallback to `#/account`.

Command:

```sh
node app/live-auth-smoke.mjs
```

Result: exit 0. The suite renders destination-less booking, payment-operations, and cancellation notifications with `#/account/payments`, `#/admin/payments`, and `#/schedule` respectively. Existing delegated tests also continue to prove:

- unread rows wait for successful mark-read before navigation;
- read rows navigate without another update;
- failed mark-read prevents navigation;
- destination-render failure after a successful mark-read is not misreported as a mark-read failure.

Command:

```sh
git diff --check
```

Result: exit 0.

## Full smoke-suite baseline concern

The exact `node app/smoke.mjs` command reaches and passes the new notification assertions, then exits later at the unrelated pre-existing assertion:

```text
Error: schedule row should surface the notice
```

The same failure reproduces from an untouched `git archive HEAD` baseline. On Saturday 29 Aug 2026 at 20:51 HKT, that test selects the next unstarted HYROX session (`2026-09-05`) while `views.scheduleState.weekOffset` remains `0`, so `viewSchedule()` renders the week of 24 Aug and cannot show the selected next-week row. Task 1 does not modify that unrelated schedule test or behavior.

## Self-review

- Exact approved fallback routes: covered.
- Explicit destinations preserved: covered.
- Malformed/foreign destinations rejected: covered.
- Unknown kind defaults to `#/account`: covered.
- Rendering without explicit destinations: covered with per-row assertions.
- Booking/session IDs inferred: none.
- Delegated mark-read semantics changed: no.
- Migration/Task 2 work: none.

## Fix Round 1 evidence

Imported the reviewer-established prerequisite commit `04bfb9c` unchanged via cherry-pick as:

```text
f1b3176 test(smoke): stabilize same-day session checks
```

The imported commit is test-only (`app/smoke.mjs`: 11 insertions, 1 deletion). Its stable patch ID matches `04bfb9c` exactly:

```text
04bfb9c patch-id: d577e0bffa08402144b78c0e7dbd148c3188d14f
f1b3176 patch-id: d577e0bffa08402144b78c0e7dbd148c3188d14f
```

Fresh verification after the import:

```sh
node app/smoke.mjs
# exit 0 — All smoke tests passed.

node app/live-auth-smoke.mjs
# exit 0

git diff --check
# exit 0

git diff --check f0ae611..HEAD
# exit 0

git diff --exit-code b60954b..HEAD -- app/js/data.js app/live-auth-smoke.mjs
# exit 0 — prerequisite did not alter notification production or live-auth behavior
```

The earlier date-sensitive baseline concern is resolved by the isolated prerequisite commit. Notification fallback behavior remains unchanged from `b60954b`.
