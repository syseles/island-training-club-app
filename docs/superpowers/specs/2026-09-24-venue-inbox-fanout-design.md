# Venue Inbox Fan-out

**Date:** 2026-09-24
**Branch:** `feature/venue-inbox-fanout` (off `main`)
**Status:** Approved for implementation
**Plan:** `docs/superpowers/plans/2026-09-24-venue-inbox-fanout.md`
**Follow-up (separate branch/PR):** Community announcement publish + inbox (`feature/community-announcement-inbox`)

## Problem

When an admin confirms a free-event venue (TBC → real place), or later edits that
venue:

1. The acting admin gets no in-app inbox row (member fan-out is `role = member`
   only; admin audit excludes the actor).
2. Members only receive a “Venue confirmed” row **once** (`member_notified_at`).
   Later venue edits do not notify members.

Leaders cannot verify what members see, and members miss venue changes after the
first confirmation.

## Approved direction

Use one **shared** row and one **audit** row for every successful venue save that
has a usable (non-TBC) location + maps query — both the first confirmation and
later edits.

| Row | Recipients | Purpose |
|---|---|---|
| Shared | All `role = member` **+ acting admin** | Member-facing venue message |
| Audit | Other `admin` / `super_admin` only (actor excluded) | Ops trail: who changed what |

Same split for first TBC→confirmed and later edits. Different shared copy only:

- First time members would have been notified historically, or when
  `member_notified_at` is still null → title **Venue confirmed**
- Subsequent usable saves → title **Venue updated**

Audit title/body stay the existing “Session venue updated / X set …” style.

Destination remains `#/activity/{sessionId}` for both rows. Kind remains
`operational_session_venue_updated` (routing/fallback maps already know it).

## Out of scope (this PR)

- Community announcement publish / inbox (follow-up branch; same recipient
  split, different kind/copy/destination; shared row gated by
  `applications.community_news`; acting admin always gets shared; audit ignores
  the toggle).
- WhatsApp / email delivery.
- Changing other notification producers (Giving, HYROX cancel, gym finalize,
  etc.).
- Shop work.

## Current behaviour (baseline)

Live `set_session_venue` (and lunch / WNT variants that share the pattern):

1. **Member fan-out** once when location + maps become usable and
   `member_notified_at` is null → `role = member` only, title “Venue confirmed”.
2. **Admin audit** on every save/reset → other admins, actor excluded, title
   “Session venue updated”.

Local `setWeekVenue` mirrors that shape in `state.notifications`.

## Target behaviour

### When to send the shared row

Send shared when the saved venue is **usable** (location and maps query present
and not TBC) and the save is a real change or first usable confirmation —
including later edits to a different place/query.

Do **not** send shared on blank reset to activity default / TBC-only states
(those remain audit-only for other admins, same as today’s reset audit).

### Recipients

- Shared: every profile with `role = member`, plus `auth.uid()` (acting admin)
  even if that actor’s role is admin/super_admin.
- Audit: every profile with `role in ('admin', 'super_admin')` and
  `id <> actor`.

An actor who is both admin and would somehow appear in the member set must not
receive two rows; they receive **only** the shared row (dedupe by profile id
across the two inserts).

### `member_notified_at`

Keep the column for “has a first confirmation ever been sent” so shared copy can
choose **Venue confirmed** vs **Venue updated**. It must **not** suppress later
shared fan-outs. Set it on the first shared send; leave it set thereafter.

### Local prototype

`setWeekVenue` must match live recipient rules and copy so smoke tests exercise
the same seam without Supabase.

## Files / surfaces

- `supabase/migrations/` — new forward migration updating
  `set_session_venue` and any sibling RPCs that still implement the old once-only
  member gate + actor-excluded-only admin pattern (free-event, lunch, WNT /
  meeting-point variants as applicable).
- `app/js/store.js` — `setWeekVenue` local fan-out.
- `app/smoke.mjs` — local recipient + later-edit assertions.
- `supabase/tests/operational_backend_integration.sql` (and related) — live
  recipient classes for first confirm, later edit, and actor inclusion.

## Testing

- Local: `node app/smoke.mjs` — first confirm notifies members + actor; later
  edit notifies members + actor again with “Venue updated”; other admins get
  audit only; actor does not get audit; reset does not shared-notify members.
- Live evidence: operational backend integration — same recipient matrix for
  `set_session_venue` (and covered siblings).

## Branching and merge

1. Create `feature/venue-inbox-fanout` from `main`.
2. Implement → smoke (+ SQL tests if SQL changes) → PR into `main`.
3. After merge, open `feature/community-announcement-inbox` from `main` for the
   announcement follow-up (separate spec).

## Open implementation notes (non-blocking)

- Exact SQL for “real change” detection (avoid duplicate shared rows if the
  admin re-saves identical location/maps). Prefer: skip shared when location and
  maps_query are unchanged from the previous stored override.
- Whether lunch/WNT RPCs are separate functions that need the same edit in one
  migration or already funnel through one body — inspect at plan time and list
  each function explicitly in the plan.
