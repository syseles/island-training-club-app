# Island Training Club Web App

This repository contains the product-discovery work, visual directions, and a working interactive prototype for a new Island Training Club community web application.

The current status is pre-production.

No production application has been built yet. The `app/` directory contains a clickable working prototype for refining flows, copy, and visuals — it is not the production implementation, and the production architecture decision remains open.

## Working Prototype

The prototype implements the selected "Night Circuit" direction and the confirmed product rules from the phase-one brief:

- Free vs paid activity classification everywhere (home, schedule, detail).
- Wednesday Night Training is free, open attendance — no booking, no capacity, no checkout. Actions are Add to Calendar (.ics download) and Get Directions.
- Weekly HYROX is paid per session at a fixed price, booked and paid in-app, with confirmation, receipt, and member-area management.
- Account lifecycle: public visitor → application → leader approval → member. Pending applicants keep public access only.
- Member area: upcoming bookings, receipts, payment history, profile.
- Admin area: applicant approval queue, activity editor (including the unresolved HYROX price/capacity as editable placeholders), member role list.
- Super Admin can additionally change member roles.

Run it (same server as the design review):

```sh
python3 -m http.server 4173
```

Open:

```text
http://127.0.0.1:4173/app/
```

The design review remains available at `http://127.0.0.1:4173/references/itc-mobile-design-directions.html`.

### Prototype conventions

- Zero dependencies, no build step. Plain ES modules so the codebase stays easy to refine; the production stack is still an open decision.
- The combined Testing candidate has explicit ownership boundaries:
  - **Supabase:** identity, roles, applications, notifications, Giving campaigns, and donor profiles.
  - **`localStorage`:** Payment operations and Community prototype interactions. Payment reservations, bookings, queues, collector duty, payout details, confirmations, receipts, and prototype donation records are keyed by the authenticated Supabase profile UUID. No real money is moved.
- Navigation combines the Notification bell with a signed-in-only Giving tab. Admin navigation contains Approvals, Members, Activities, Giving, HYROX, and Payments / Ops.
- Persisted prototype state is **v14** and accepts/migrates existing **v9–v13** snapshots without discarding genuine domain records.
- With Supabase configured, a new Google profile remains `pending` until its application is submitted and an Admin approves it. Pending and declined profiles cannot use Payment or Giving controls.
- Without Supabase configuration, local state starts empty. Apply through the membership flow to create a local pending profile, which can then sign in again by email (no password).
- `app/js/store.js` remains the backend seam across both ownership domains until a production backend is selected.
- Static Vercel deployment has no env-injection/build step. Live Supabase browser configuration is set explicitly in `app/index.html`; deployment steps and credential boundaries are documented in `docs/runbooks/live-auth.md`.
- Giving's `PGRST205` fallback keeps the member route reachable but does not enable donations. Functional Giving requires the ordered schema migrations and a real campaign published through **Admin Tools → Giving**; follow the [Giving schema and campaign recovery steps](docs/runbooks/live-auth.md#giving-schema-and-campaign). No fake campaign data is restored.
- Administrative testing requires Supabase live mode or the historical `archive/demo` branch. The archive is demonstration-only and must not be used as a production source branch.
- `app/smoke.mjs` is a headless regression check for the product rules (`node smoke.mjs` from `app/`).

### Deliberately not in the prototype

- Merchandise shop (deferred in the phase-one brief).
- Real payments, delivered email receipts, outbound messages, and a service worker (manifest is included; a cache layer would fight the refinement loop). Live in-app notifications are Supabase-backed when configured.
- Final privacy/guidelines copy and any post-workshop legal/policy revisions. The supplied Hyrox indemnity source is implemented; privacy and guidelines remain provisional.

## Selected Direction

Version 1, “Night Circuit,” is the selected visual direction.

It extends the existing Island Training Club website with a black technical grid, electric-lime accents, documentary community photography, and direct activity actions.

![Selected Night Circuit direction](references/itc-mobile-direction-1.png)

## Review The Designs

Run a static local server from the repository root:

```sh
python3 -m http.server 4173
```

Open:

```text
http://127.0.0.1:4173/references/itc-mobile-design-directions.html
```

The review includes three historical directions with five screens each.

Version 1 is the chosen starting point.

## Product Documents

- [Phase-one product brief](docs/phase-one-product-brief.md)
- [Detailed brainstorming notebook](docs/itc-web-app-product-notes.md)
- [Collaboration handoff](docs/handoff.md)
- [Live Auth operational runbook](docs/runbooks/live-auth.md)

## Phase-One Summary

- Responsive, mobile-first web application.
- Architecture prepared for later iOS and Android clients.
- Public access to free activities, leaders, and culture.
- Leader approval required for full member access.
- Wednesday Night Training is free and requires no booking.
- Weekly HYROX is a paid, recurring launch activity.
- HYROX is purchased separately for each session at one fixed price.
- Paid booking and payment happen inside the application.
- Member, Admin, and Super Admin roles.

## Collaboration

The repository intentionally has no branch-protection requirement.

Authorized collaborators may push directly after they are added to the GitHub repository.

The collaborator’s GitHub username is still needed before access can be granted.
