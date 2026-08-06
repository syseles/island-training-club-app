# Approved-Member Giving Access Design

Date: 2026-08-05
Branch: `feature/giving-page`

## Goal

Restrict Giving content and transfer controls to approved members while giving pending and declined users a clear locked state.

## Access Matrix

| User state | Giving navigation | Direct `#/giving` route | Giving content |
|---|---|---|---|
| Visitor | Hidden | Redirect to `#/account` | Never rendered |
| Pending | Visible | Locked Giving screen | Hidden |
| Declined | Visible | Locked Giving screen | Hidden |
| Approved member | Visible | Full Giving page | Visible |
| Admin | Visible | Full Giving page | Visible |
| Super Admin | Visible | Full Giving page | Visible |

Local `superadmin` and live `super_admin` roles receive the same approved access.

## Navigation

Giving is removed from visitor navigation. It remains visible to signed-in users so pending and declined members can understand why access is unavailable rather than encountering a missing destination.

The existing visitor navigation and Account entry point remain unchanged otherwise.

## Visitor Route Handling

The router guards `#/giving` before rendering Giving HTML. A visitor receives a redirect object targeting `#/account`; campaign totals, donation history, FPS instructions, transfer controls, donor information, and confirmation content must never enter the DOM.

This route guard is defense in depth for direct links and stale browser history. Navigation hiding alone is not sufficient.

## Locked Giving Screen

Pending and declined users see a dedicated locked screen containing:

- Page kicker and “Giving” heading
- Lock/status treatment consistent with paid-event booking locks
- Clear copy that Giving is available to approved ITC members
- Pending-specific explanation that access unlocks after leadership review
- Declined-specific explanation directing the user to contact an ITC leader if they need help
- Link to Profile
- Link to Schedule/free activities

The locked screen contains no campaign progress, suggested amounts, giving history, donor IDs, QR/FPS details, transfer instructions, or donation actions.

## Approved Access

A user has full Giving access when `status === 'approved'`. This includes member, Admin, and Super Admin roles in both local and live modes. Existing Giving campaign, FPS prototype flow, confirmation, history, and donor-profile links remain unchanged.

## Code Boundaries

- `views.js` owns Giving navigation visibility and locked/full Giving rendering.
- `app.js` owns visitor direct-route redirection.
- `store.js` requires no state-shape change.
- No database migration is required.

## Error and Accessibility Behavior

- The locked state uses a real heading and descriptive text.
- Links remain keyboard accessible and meet the shared 44px target once shared UI improvements are merged.
- Access never depends only on color or iconography.
- No false campaign or transfer data appears while access is locked.

## Commit Boundary

This access change must be implemented in one separate commit on `feature/giving-page`, independent of shared Auth UI, Admin, and Notification work.

## Testing

Smoke coverage must prove:

1. Visitor navigation contains no Giving item.
2. Direct visitor Giving access redirects to `#/account`.
3. Visitor-rendered HTML contains no Giving campaign or FPS content.
4. Pending navigation includes Giving.
5. Pending Giving renders the locked screen and no sensitive Giving content.
6. Declined navigation includes Giving.
7. Declined Giving renders the locked screen and no sensitive Giving content.
8. Approved member Giving renders the complete existing Giving flow.
9. Admin and Super Admin Giving render the complete existing Giving flow.
10. Existing Giving amount, FPS confirmation, history, and donor-profile behavior remain green.
