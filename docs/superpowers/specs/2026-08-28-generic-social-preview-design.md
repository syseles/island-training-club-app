# Generic Social Preview Design

## Goal

Make the Community feature card useful for every upcoming event in the `Socials` category rather than specifically describing the recurring post-training lunch. Clicking the card should take the member directly to the earliest upcoming social event.

## Approved product direction

The card will use generic, future-proof language:

- Kicker: `Socials`
- Title: `Connect beyond training`
- Supporting copy: `Meet up, share a meal, and find your people.`
- Dynamic detail: `Next up: <event name> · <date>`
- CTA: `View next social`

The event name and date are rendered from the selected upcoming social, so a future one-off social is represented without another copy change.

## Selection and navigation

Add a small store-level selector for the next social event. It will:

1. Read the app's existing upcoming-session data across the same 7-day calendar window as Schedule's `This week` view: today through six days after today.
2. Keep sessions whose category is exactly `Socials`.
3. Keep sessions dated within that window, using the app's local Hong Kong date semantics. Events after the 7-day window must not be selected.
4. Sort by ISO date and then start time, matching Schedule ordering.
5. Return the earliest session or `null` when none exists.

`communityHome()` will use this selector. When a result exists, the CTA will link directly to `#/activity/<session-id>`. When no social exists, the card will retain a useful generic message and link to `#/schedule` as a safe fallback.

The selector must work for local recurring sessions, local one-off sessions, and live operational sessions exposed through the existing store seam. It will not add a second data source or mutate state.

## Rendering and accessibility

The existing Community feature card remains the same component and layout. Only its copy, dynamic event detail, and CTA destination change. The heading retains `id="next-connection-title"`; the section's `aria-labelledby` relationship remains intact. Event names and dates are escaped/formatted through existing view helpers.

## Testing

Update local smoke coverage to verify:

- The Community card uses the generic copy and no longer contains lunch-only wording.
- The card shows the earliest Socials event's name/date.
- The CTA points to that event's activity route.
- A later Socials event is not selected when an earlier one exists.
- Non-Socials events do not displace the selected social.
- The no-result fallback points to Schedule.

Keep the existing RSVP and chronological scheduling assertions unchanged. Run `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, and `git diff --check` before commit.
