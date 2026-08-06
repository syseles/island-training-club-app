# Notification Kind Filters Design

Date: 2026-08-06
Branch: `feature/notification`

## Goal

Replace the static “Club operations” / “My notifications” section split with one chronological, tappable, role-aware notification list filtered by clear event kinds.

## Terminology and Filters

“Admin notifications” is clearer than “Club operations”; “Club updates” is reserved for member-wide news such as a newly published Giving campaign.

Admin and Super Admin filters:

- All
- Applications (`admin_application_submitted`)
- Decisions (`admin_application_approved`, `admin_application_declined`)
- Role changes (`admin_role_promoted`, `admin_role_demoted`, `admin_membership_revoked`)
- Club updates (`giving_campaign_published` and future member-wide club kinds)
- My account (all remaining personal kinds)

Regular member filters:

- All
- Club updates
- My account

Use one newest-first list. Each row displays a category badge. Filters are semantic 44px buttons with `aria-pressed`, horizontally scrollable at narrow widths, use Night Circuit chip styling, and retain keyboard focus after rerender. State is view-local and resets to All on a new session; it does not enter localStorage.

`giving_campaign_published` maps to Club updates and destination `#/giving` even before the Giving branch starts producing it.

Empty copy names the active filter. A completely empty inbox still displays “New notifications will appear here.”

## Commit Boundary

Implement in one Notification-specific commit after merging Auth’s Archivo/member-filter commits. No campaign creation, Giving data, or notification trigger is added here.

## Testing

Cover role-specific available filters, category mapping, `aria-pressed`, one chronological list, category badges, combined kind mapping, filter activation/focus, active-filter empty states, malformed kinds falling back to My account, and the Giving destination mapping.
