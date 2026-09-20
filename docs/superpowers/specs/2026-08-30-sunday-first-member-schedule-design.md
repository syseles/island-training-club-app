# Sunday-First Member Schedule Design

**Status:** Approved for implementation on `feature/update-existing`

## Scope

Change only the member-facing Schedule calendar from a Monday-first week to a Sunday-first week. The Schedule week runs Sunday through Saturday for visitors, pending applicants, members, and admins viewing the member Schedule tab.

Home and Admin retain their existing week definitions. In particular, Home’s “This week” / “My Week” calculations and Admin payment-duty and operational-week calculations remain Monday-based.

## Behaviour

- The seven-day Schedule strip is ordered `Sun Mon Tue Wed Thu Fri Sat`.
- “Week of” displays the Sunday that begins the visible week.
- A fresh Schedule visit opens the current Sunday–Saturday week and keeps the current local date selected.
- Moving to a non-current week selects that week’s Sunday.
- Previous and next navigation changes the week offset by one and therefore moves exactly seven calendar days between Sundays.
- Returning to the current week selects the current local date rather than Sunday.
- Session generation, day markers, empty states, filtering, booking badges, and cancellation notices continue to use the visible seven-day range.

## Architecture

Add an exported, pure `sundayOf(date)` helper beside `mondayOf(date)` in `app/js/data.js`. Keep `mondayOf` unchanged for Home and Admin consumers.

In `app/js/views.js`, centralize the Schedule selection fallback in an exported pure `scheduleSelectionForWeek(referenceDate, weekOffset)` helper. Both Schedule rendering and the app’s week-navigation handler use this contract, preventing the render and click paths from disagreeing about Sunday boundaries.

The Schedule renderer derives its range from `sundayOf`, renders Sunday-first labels, and generates seven days beginning at that Sunday. No store schema or persistence changes are required.

## Testing

Extend `app/smoke.mjs` before implementation with literal, hand-checked regressions that cover:

- `sundayOf` on Sunday, Monday, and Saturday boundaries;
- Sunday-first strip order and “Week of” output;
- current-week selection of today;
- next/previous non-current selection on Sundays exactly seven days apart;
- return navigation to the current date;
- non-current render fallback to Sunday;
- existing booked-session Schedule offset calculations using Sunday boundaries.

Run the local smoke suite after each red/green cycle. Final verification also runs live-auth smoke, JavaScript syntax checks, and `git diff --check`.

## Constraints

- No changes to Home or Admin week semantics.
- No localStorage migration or state-shape change.
- No Shop work, dependencies, build step, or unrelated refactor.
- Do not touch or stage any pre-existing untracked file, including `.superpowers` artifacts, images, and the existing untracked design document.
