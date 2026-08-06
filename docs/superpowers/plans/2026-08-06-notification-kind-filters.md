# Notification Kind Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Turn Notifications into one chronological list with role-aware, tappable kind filters.

**Architecture:** Pure category/destination helpers classify stable kinds; `notificationFilters` is view-local; semantic chips update it through delegated actions and rerender with focus restoration.

**Tech Stack:** Vanilla ES modules, HTML/CSS, Node smoke tests

## Constraints

- Work only on `feature/notification`.
- One Notification-specific implementation commit.
- Prepare but do not generate Giving campaign notifications.
- Preserve mark-read, unread bell, timestamp, and RLS behavior.

### Task 1: Implement Kind Filtering

**Files:** Modify `app/js/data.js`, `app/js/views.js`, `app/js/app.js`, `app/styles.css`, `app/smoke.mjs`, `app/live-auth-smoke.mjs`.

- [ ] Add failing pure tests for `notificationCategory(kind)`: application, decision, role, club, personal; malformed kind returns personal. Assert `giving_campaign_published` destination is `#/giving`.
- [ ] Add failing render tests: Admin filters All/Applications/Decisions/Role changes/Club updates/My account; member only All/Club updates/My account; active chip has `aria-pressed=true`; static Club operations/My notifications headings are absent; one newest-first list and category badges render; active empty state names its filter.
- [ ] Add failing delegated tests proving chip activation updates view-local state, rerenders without another notification fetch when rows are already loaded for the route, and restores focus to the same chip.
- [ ] Export `notificationCategory(kind)` and extend `notificationDestination()` for `giving_campaign_published -> #/giving`.
- [ ] Export `notificationFilters = { kind: "all" }`; render role-aware chip buttons (`data-action="notification-filter"`, `data-notification-filter`) with 44px Night Circuit styling and horizontal overflow.
- [ ] Replace section split with a single filtered chronological list. Add category badge per row and preserve semantic button, unread indicator, relative/HKT time, datasets, and escaping. Use filter-specific empty text; retain whole-inbox explanation.
- [ ] Handle delegated filter activation using already fetched route rows, rerender current Notification HTML, then restore focus via stable selector. Avoid Supabase refetch for a local filter change.
- [ ] Run both smoke suites, all JS syntax checks, and `git diff --check`.
- [ ] Commit exactly: `feat(notifications): add interactive kind filters`.

### Task 2: Final Verification

- [ ] Run full smoke, syntax, diff, status, and scope checks.
- [ ] Verify no Giving campaign persistence/trigger or unrelated behavior was introduced.
- [ ] Do not create an empty commit.
