# Archivo Typography and Member Filters Design

Date: 2026-08-06
Branch: `feature/auth-identity`

## Goal

Restore broad, readable typography across the app and simplify the Admin Members toolbar by removing redundant counts and replacing native dropdown filters with Night Circuit filter chips.

## Typography

Use Archivo Regular (normal width), not Archivo Narrow or a condensed face, for all ordinary UI text:

- Body copy
- Headings and greetings
- Profile member names
- Labels and helper text
- Buttons, tabs, badges, and navigation

Weights create hierarchy: 400–500 body, 600–700 controls/labels, and 700–800 headings. Preserve the system monospace stack only for technical identifiers such as FPS IDs, donor IDs, booking references, receipt numbers, and transfer references.

Self-host one pinned Archivo v25 Latin variable WOFF2 (`100 900`) in `assets/fonts/archivo-latin-variable.woff2`, with the official OFL license. Use `font-display: swap`, preload only that file, and retain native sans-serif fallbacks. Remove all Barlow/Barlow Condensed assets, declarations, preload references, and runtime usage.

## Members Toolbar

Remove the Approved/Pending/Declined count summary above the Members list. Retain a short role-permission explanation only.

Keep the search field, then render two labeled chip groups:

### Status

- All
- Approved
- Pending
- Declined

### Role

- All roles
- Member
- Admin
- Super Admin

Chips are semantic buttons with `aria-pressed`, at least 44px tall, horizontally scrollable on narrow screens, and use the existing dark surface/border plus electric-lime active treatment. Status and role filters combine with search. Show “Clear filters” only when query/status/role differs from defaults. Activating a chip updates the list and restores keyboard focus to the same filter after rerender. Filter state remains view-local and never enters localStorage.

## Branch and Commit Boundaries

Create two separate commits on `feature/auth-identity`:

1. Simplify and restyle Admin Members filtering.
2. Replace Barlow with Archivo app-wide.

No Giving, campaign, Shop, or Notification behavior is added.

## Testing

Cover:

- Counts are absent while role guidance remains.
- Native status/role selects are absent.
- Every chip has correct `aria-pressed` state and 44px styling.
- Search/status/role combine correctly.
- Clear filters appears conditionally and resets all view-local filter state.
- Focus returns to the activated filter chip.
- Archivo file, preload, variable `@font-face`, swap, and OFL license exist.
- Barlow files/declarations/preloads are removed.
- Both normal font tokens use Archivo; monospace token remains unchanged.
- Existing Admin, auth, Profile, application, and smoke behavior remains green.
