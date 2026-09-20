# Task 7 Report — Combined Cross-Feature Regression Tests

## Commit

`38265425de53c655e6cfd8f919a4488dd63fffec` — `test(integration): cover routes payments counts and hydration`

## Coverage added

- Paid booking notification exact route renders the final safe PayMe and QR-free same-device FPS payment view.
- RSVP notification exact route and attendee count agree across Sunday-first Schedule, Activity Details, and grouped Admin controls.
- Assigned-payout and RSVP-count enrichment failures degrade independently and recover while core paid and RSVP sessions remain available.

## RED evidence

Controlled mutations failed with:

- `notification-routed Payment view must keep the normalized safe PayMe handoff`
- `dated RSVP Admin card must render count 1 inside grouped Weekly Event Controls`
- `successful RSVP counts must survive assigned-payout degradation`
- `assigned payout hydration must survive RSVP-count degradation`

All mutations were restored before commit. No production defect or production-file change was required.

## Verification

- HKT smoke and live-auth smoke: passed.
- Los Angeles smoke and live-auth smoke: passed.
- 13 JavaScript/MJS syntax checks: passed.
- 6 shell syntax checks: passed.
- 3 database safety self-tests: passed.
- Retired FPS QR, whitespace, conflict-marker, and scope checks: passed.
- Independent reviewer approved; controlled mutation rechecks detected PayMe safety, Admin count, and enrichment-coupling defects.

## Limitation

Connected PostgreSQL replay was unavailable and remains a deployment prerequisite.
