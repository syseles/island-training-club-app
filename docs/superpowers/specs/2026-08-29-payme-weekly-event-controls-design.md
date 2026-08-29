# PayMe Handoff and Weekly Event Controls Design

## Goals

1. Make the member PayMe button open the on-duty collector’s saved PayMe personal link instead of being interpreted as an in-app relative route.
2. Give members an accurate, copyable payment note containing the session and payer information needed by the collector.
3. Replace two ambiguous weekly Admin sections with one clear Weekly Event Controls hierarchy.

## Branch baseline

`feature/admin-ops` is fast-forwarded to the current `testing` baseline before implementation so it contains RSVP events, the current payout profile behavior, and the existing free/RSVP weekly controls.

## PayMe personal-link behavior

The collector continues to save their PayMe link under Admin > Payments. The app will normalize and validate that value before using it:

- Trim surrounding whitespace.
- Add `https://` when an otherwise valid PayMe host was entered without a scheme.
- Accept HTTPS links on the official `payme.hsbc.com.hk` host.
- Require a collector-specific path rather than the generic PayMe homepage.
- Reject other protocols, hosts, malformed URLs, and generic homepage links with clear form feedback.

The member payment screen will use the normalized absolute URL in an external anchor. On supported devices, the PayMe universal link can launch the PayMe app with the collector selected; browser fallback remains controlled by PayMe.

The UI must not claim that the amount is embedded or prefilled. It will tell the member to enter the displayed amount manually and use the suggested note.

If no valid collector PayMe link exists, the PayMe action is non-clickable and explains that FPS should be used instead. It must never render an empty or relative `href` that routes back into the ITC app.

## Live payout visibility and consistency

An approved member must be able to read payout details only for collectors who appear in `collector_assignments`. Keep the payout table’s existing self/Admin RLS unchanged; expose assigned collector payout rows through a narrow authenticated `SECURITY DEFINER` RPC that rejects visitors and pending/declined profiles. Live hydration merges those assigned rows with rows already visible under normal RLS, allowing Admin payout management and cold member payment handoff without exposing arbitrary unassigned payout profiles.

Live payout edits are authoritative only after the Supabase update succeeds. A rejected RPC must leave the device-local payout cache unchanged, keep the submitted form rendered, and surface error feedback. Capture `FormData` before disabling controls because native `FormData` omits disabled inputs; then disable the payout form controls while the request is pending to prevent duplicate submissions.

Assigned-payout hydration is optional enrichment, not a prerequisite for Schedule or Admin Activities. Failure of `get_assigned_collector_payout_profiles()`—including an undeployed migration, anonymous execution denial, or pending/declined role denial—must not discard successfully fetched sessions, bookings, templates, assignments, or venue overrides. Continue with directly RLS-visible payout rows, expose the payout problem as degraded payment data, and keep HYROX and lunch sessions visible. Once migration `20260829000005_assigned_collector_payout_rpc.sql` is applied, approved cold-member hydration gains the assigned collector’s payout row.

## Suggested payment note

Generate the note from the booking snapshot and current member:

`<session name> · <date> · <location> · <member name>`

Example:

`ITC HYROX · 5 Sep · BFT Causeway Bay · Riley Runner`

Use the booking snapshot’s session name, date, and location so the note matches what the member reserved. Use the member’s full name, falling back to the available display name. Escape the rendered note and provide a dedicated Copy note control using the existing delegated clipboard pattern.

The payment note is guidance, not an in-app payment field. The member manually pastes or types it into PayMe.

## Weekly Event Controls hierarchy

On Admin > Activities, replace the two top-level sections `Weekly Venue Overrides` and `Weekly Session Overrides` with one top-level collapsible section:

### Weekly Event Controls

Supporting copy:

`Manage one dated event without changing its recurring defaults.`

Inside it, render two clearly labelled groups.

### Free & RSVP Events

Contains the existing controls for dated non-paid recurring events:

- Display venue and Google Maps search.
- WNT meeting-point picker where supported.
- Reset to recurring default.
- RSVP count and dated cancellation for RSVP events.

### Paid Sessions

Contains the existing paid recurring-session controls:

- Time.
- Venue status.
- Session note.
- Midtown open/close where supported.
- Dated cancellation.

One-off Events remains a separate top-level section because its workflow creates and deletes single-date events rather than overriding a recurring instance. Finalize with gym remains under Payments because it is payment-side operational work.

The combined section changes hierarchy and copy only. It does not merge the distinct free/RSVP and paid form contracts into one universal form.

## Accessibility and rendering

- Keep the top-level controls in semantic `<details>`/`<summary>` markup.
- Use headings for `Free & RSVP Events` and `Paid Sessions` so Admins can scan the groups.
- Preserve all existing form IDs, `data-action` values, labels, and delegated handlers.
- Preserve current cards, badges, cancellation states, and responsive behavior.

## Testing

PayMe smoke coverage will verify:

- Native-form semantics preserve the entered PayMe link by capturing payload before controls are disabled.
- An unavailable/unauthorized assigned-payout RPC degrades only payout enrichment; Schedule still shows paid HYROX and RSVP lunch sessions, and Admin Paid Sessions remains populated.
- Anonymous, pending, and declined hydration can still load public operational sessions.
- A cold approved-member hydration receives the assigned collector’s payout row through the narrow RPC even when direct table RLS returns no collector payout rows.
- Pending/declined/anonymous callers cannot use the assigned-payout RPC, and unassigned payout profiles are not returned.
- Rejected live payout updates leave the prior device-local value unchanged while preserving the form and feedback.
- A scheme-less official personal link becomes an absolute HTTPS link.
- A generic homepage, foreign host, malformed link, or non-HTTPS protocol is rejected.
- The payment anchor targets the normalized collector link and cannot become an in-app relative route.
- The old “amount is ready” copy is absent.
- The suggested note includes session name, formatted date, location, and member name.
- Copy note delegates to the clipboard handler.
- Missing/invalid links produce an FPS fallback rather than a clickable PayMe action.

Admin smoke coverage will verify:

- Exactly one top-level `Weekly Event Controls` section appears.
- `Free & RSVP Events` and `Paid Sessions` both appear inside it.
- The old top-level section titles are absent.
- Free/RSVP forms retain venue, reset, RSVP count, and RSVP cancellation controls.
- Paid forms retain time, notice, venue-status, Midtown, and cancellation controls.
- One-off Events remains separate and Payments does not absorb weekly setup controls.

Run `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, and `git diff --check` before completion.
