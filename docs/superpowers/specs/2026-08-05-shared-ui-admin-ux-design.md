# Shared UI Accessibility and Admin UX Design

Date: 2026-08-05
Branch: `feature/auth-identity`

## Goal

Improve the prototype's typography, responsive behavior, keyboard/screen-reader access, asynchronous feedback, form errors, and Admin information architecture without changing product rules or introducing a framework.

## Scope and Branch Boundary

This is shared non-Shop work on `feature/auth-identity`. It must not add Giving, Shop, merchandise, campaign, or FPS functionality. Notification-specific top-bar bell, Notification page, and database triggers belong to `feature/notification` and are not implemented by this specification.

## Visual Direction

Preserve the existing Night Circuit identity:

- Dark technical grid
- Electric-lime accent
- Documentary photography
- Restrained corner radii
- Condensed athletic headings
- Direct, community-oriented copy

This work refines rather than rebrands the application.

## Self-Hosted Typography

Self-host official Latin-subset WOFF2 fonts in `assets/fonts/`:

- Barlow variable font for body and UI
- Barlow Condensed variable font for headings
- Official SIL Open Font License text

Implementation requirements:

- Define local `@font-face` declarations.
- Use `font-display: swap`.
- Preload only the primary body font from `app/index.html`.
- Retain a native system stack as fallback.
- Do not depend on Google Fonts at runtime.
- Preserve readable content when fonts fail or are still loading.

## Typography and Contrast

Increase very small UI text while preserving hierarchy:

- Bottom-navigation and compact navigation labels: 11–12px minimum
- Form labels: 12px minimum
- Essential metadata/helper text: 12px minimum
- Badges: 10–11px minimum
- Body text: 14–16px

`--muted` remains suitable for secondary text. Brighten `--faint` wherever it conveys essential information and increase functional border contrast for inputs, tabs, cards, and separators. Normal text must target WCAG AA 4.5:1; large text and meaningful UI boundaries target at least 3:1 where applicable.

## Spacing and Touch Targets

Use the existing 4/8px rhythm consistently. Every interactive control receives a minimum 44×44px hit target, including:

- Avatar/account control
- Compact buttons
- Chips and filters
- Week navigation controls
- Admin actions
- Checkbox/radio label regions

Adjacent high-impact actions retain at least 8px separation. Pressed states may change opacity/color/elevation but must not shift surrounding layout.

## Responsive Layout

At widths below 420px:

- Two-column `.field-row` forms stack to one column except compact fields explicitly designed to remain paired.
- Admin decision controls stack when horizontal space is insufficient.
- Member rows allow identity and actions to wrap without clipping.
- Long email addresses wrap safely.
- Fixed navigation never hides scroll content.

The existing mobile shell remains the primary prototype canvas. Tablet/desktop receives adaptive gutters and readable text measure, but a full desktop redesign is out of scope.

## Keyboard and Screen-Reader Access

- Add a visible-on-focus “Skip to main content” link.
- Add a consistent `:focus-visible` ring to links, buttons, fields, chips, tabs, and other controls.
- Preserve native semantics; do not make generic `<div>` elements interactive.
- After a successful route render, focus `<main>` without a visible pointer-focus ring so screen-reader and keyboard users hear the new view.
- Keep `aria-current="page"` on selected primary navigation.
- Mark current Admin tabs semantically.
- Use real headings in sequential order.
- Do not communicate state by color alone.

## Reduced Motion

Respect `prefers-reduced-motion: reduce` by removing non-essential animations and transitions, including toast entry movement and smooth scrolling. No new complex motion library is added.

## Shared Async Feedback

Create small reusable helpers rather than duplicating per-form logic.

### Route reads

For asynchronous Account and Admin reads:

- Set `aria-busy="true"` on `<main>` immediately.
- Keep the previous screen in place during the request.
- Show a lightweight loading indicator only if the operation exceeds approximately 300ms, preventing fast-response flashes.
- Clear loading and `aria-busy` after success or error.
- On failure, retain the previous screen and expose an accessible error toast.

Notification route loading belongs to `feature/notification` but will reuse this behavior.

### Actions and submissions

For asynchronous saves and decisions:

- Disable the initiating control immediately.
- Preserve its original label.
- Use specific progress labels such as “Saving…”, “Approving…”, “Declining…”, or “Submitting…”.
- Prevent duplicate submissions.
- Restore controls on error.
- Toast success only after the underlying operation succeeds.
- Retain relevant content and show an accessible error on failure.

## Accessible Form Errors

- Error summaries use `role="alert"` or an assertive live region.
- Invalid fields receive `aria-invalid="true"`.
- Error/help text is associated through `aria-describedby`.
- Focus moves to the first invalid field after custom validation fails.
- Editing an invalid field clears its stale custom error and `aria-invalid` state.
- Native `reportValidity()` remains available for required/type constraints.
- Existing visible labels and autocomplete/inputmode attributes remain intact.

## Admin Information Architecture

The canonical Admin surface remains `#/admin` with Approvals, Activities, and Members tabs. `#/admin/users` redirects to or renders the canonical experience instead of maintaining a second visual system.

### Approvals

Split the queue into two ordered groups:

1. **Ready for review (n)** — submitted applications, actionable and shown first.
2. **Awaiting application (n)** — pending profiles without applications, visually quieter and not actionable.

Each group has accurate empty-state copy. The page-level empty state refers to pending members/profiles rather than incorrectly saying every pending profile is an application.

Submitted application cards retain full identity, emergency, consent, and age-status details. Incomplete cards retain only available identity and explanation; they never fabricate application data.

### Decisions

- Approve is the clear primary action.
- Decline is secondary/destructive.
- Both controls are at least 44px high.
- Decline asks for confirmation naming the applicant.
- During either request, both card actions are disabled and the initiating label changes.
- On failure, the card remains visible and receives an inline error in addition to the accessible toast.
- Existing store/database decision validation remains authoritative.

### Members

The Members tab shows counts for:

- Approved
- Pending
- Declined

It also provides:

- Search by name or email
- Status filter: All, Approved, Pending, Declined
- Role filter: All, Member, Admin, Super Admin
- Human-readable role labels
- Empty results message that reflects active filters

Search/filter state may remain view-local and does not change localStorage shape.

### Role changes

Promote, demote, and revoke require confirmation that names the affected person and target state. While updating, the control is disabled; errors restore the previous UI without false success. Super Admin self-protection rules remain unchanged.

## Notification Navigation Preparation

The shared branch may prepare top-bar spacing and reusable icon-button/badge styles, but it must not move Notifications out of primary navigation until `feature/notification` provides a working top-bar bell. This avoids removing the only Notification entry point between branches.

Admin remains accessible from Profile > Admin Tools. Removal of the Admin bottom-nav item is permitted because the Profile entry already exists; Notification-specific final five-item navigation is completed on `feature/notification`.

## Code Boundaries

- `styles.css`: fonts, tokens, touch targets, focus, reduced motion, responsive rules, reusable loading/error/Admin styles.
- `index.html`: font preload, skip link, reusable loading target semantics.
- `views.js`: semantic markup, Admin grouping/filter controls, human-readable labels.
- `app.js`: route focus/busy handling, async control helpers, form-error helper, Admin confirmation/filter events.
- `store.js`: no localStorage shape changes; only focused actions if required for truthful async behavior.
- `smoke.mjs` and `live-auth-smoke.mjs`: behavior and source-contract regressions.

## Commit Boundaries

Use separate reviewable commits:

1. Self-host fonts and improve visual/accessibility foundations.
2. Add shared route/action/form feedback.
3. Improve Admin queue and member management UX.

Do not mix Notification database behavior or Giving access into these commits.

## Testing

Coverage must verify:

1. Font assets, OFL license, `@font-face`, swap behavior, preload, and fallbacks.
2. Global focus-visible and reduced-motion contracts.
3. Skip link and route focus behavior.
4. Minimum interactive sizing for affected compact controls.
5. Small-phone form and Admin-action stacking.
6. Route `aria-busy` lifecycle and delayed loading behavior.
7. Async controls disable, label progress, recover on error, and prevent duplicate work.
8. Accessible form alerts, `aria-invalid`, descriptions, focus, and stale-error clearing.
9. Approvals group submitted and incomplete profiles correctly with counts and truthful empty states.
10. Decline confirmation and inline failure retention.
11. Member counts include declined users.
12. Search and status/role filters return truthful results and empty states.
13. Role labels and confirmations are human-readable.
14. Legacy Admin users route no longer renders undefined legacy classes.
15. Existing auth, Profile, application, booking, Admin permissions, and complete smoke suites remain green.
