# Venue Inbox Fan-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fan out free-event venue saves so members and the acting admin share one “Venue confirmed/updated” inbox row, other admins get the audit row, and later venue edits re-notify members.

**Architecture:** Keep `store.setWeekVenue()` as the sole UI seam. Change local fan-out in `setWeekVenue` to match the new recipient matrix, then ship a forward-only migration that replaces the authoritative six-argument `public.set_session_venue` body (four-argument overload stays a thin wrapper). Kind, destination, and local notification shape stay unchanged.

**Tech Stack:** Vanilla ES modules, localStorage prototype state, Supabase Postgres RPCs/migrations, Node smoke tests, SQL operational integration tests.

**Spec:** `docs/superpowers/specs/2026-09-24-venue-inbox-fanout-design.md`

## Global Constraints

- Branch: `feature/venue-inbox-fanout` off `main` (non-Shop only).
- Do not implement community announcements in this plan.
- Do not edit previously shipped venue migrations; add only `supabase/migrations/20260924000001_venue_inbox_fanout.sql`.
- Keep kind `operational_session_venue_updated` and destination `#/activity/{sessionId}`.
- Keep local notification shape (`link`, `createdAt`, `read` — no `destination` / `read_at` / `created_at` on persisted local rows).
- Preserve WNT Tamar meeting-point validation and lunch null meeting coordinates.
- Preserve four-argument `set_session_venue` as a wrapper around the six-argument RPC.
- Skip shared fan-out when location and maps_query are unchanged (coordinate-only edits → audit only for other admins).
- Skip shared fan-out on blank reset / non-usable (TBC/partial) venues; audit for other admins still fires on real resets.
- Run `node app/smoke.mjs` and `git diff --check` before claiming done. Run `supabase/tests/verify_operational_backend.sh` when SQL changes are in place (if the environment supports it).

## File map

| File | Responsibility |
|---|---|
| `app/smoke.mjs` | Local recipient matrix + later-edit expectations (TDD driver) |
| `app/js/store.js` (`setWeekVenue`) | Local fan-out matching live rules |
| `supabase/migrations/20260924000001_venue_inbox_fanout.sql` | Authoritative six-arg `set_session_venue` + four-arg wrapper |
| `supabase/tests/operational_backend_integration.sql` | Live recipient assertions for first confirm, later edit, reconfirm, actor inclusion |

---

### Task 1: Branch + failing local smoke expectations

**Files:**
- Create branch: `feature/venue-inbox-fanout` from `main`
- Modify: `app/smoke.mjs` (venue override block ~5112–5298 and coordinate-only block ~5331–5344)

**Interfaces:**
- Consumes: existing `store.setWeekVenue`, `venueNotesFor(userId, sessionId)`, fixtures `fixture-admin` (actor), `fixture-member`, `fixture-other-admin`, `fixture-pending-user`
- Produces: failing assertions that encode the approved recipient matrix

- [ ] **Step 1: Create the branch**

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b feature/venue-inbox-fanout
```

- [ ] **Step 2: Rewrite first-confirmation recipient assertions**

In the block after the first `setWeekVenue` on `wntSession` that currently expects `actorNotes.length` to be 0, replace with:

```js
if (memberNotes.length !== 1) {
  throw new Error("first confirmation must notify each member exactly once");
}
if (memberNotes[0]?.title !== "Venue confirmed") {
  throw new Error("first confirmation shared title must be Venue confirmed");
}
if (actorNotes.length !== 1) {
  throw new Error("acting admin must receive the shared venue notification");
}
if (actorNotes[0]?.title !== "Venue confirmed"
    || actorNotes[0]?.body !== memberNotes[0]?.body) {
  throw new Error("acting admin shared row must match member copy");
}
if (otherAdminNotes.length !== 1) {
  throw new Error("other admin must receive audit notification on actual save");
}
if (otherAdminNotes[0]?.title !== "Session venue updated") {
  throw new Error("other admin must receive the audit title");
}
if (pendingNotes.length) {
  throw new Error("pending profile must not receive venue notifications");
}
```

Keep the existing body-copy checks for member and other-admin audit text.

- [ ] **Step 3: Rewrite later-edit / reset / reconfirm expectations**

Replace the “subsequent edits must not re-notify members” block through reconfirmation with:

```js
// No-op save must not notify anyone.
store.setWeekVenue(wntSession.id, {
  location: "Central Harbourfront — 7pm sharp",
  mapsQuery: "Central Harbourfront, Hong Kong",
});
if (venueNotesFor("fixture-member", wntSession.id).length !== 1
    || venueNotesFor("fixture-admin", wntSession.id).length !== 1
    || venueNotesFor("fixture-other-admin", wntSession.id).length !== 1) {
  throw new Error("no-op save must not duplicate venue notifications");
}

// Later edit: shared to members + actor (Venue updated); audit to other admins.
store.setWeekVenue(wntSession.id, {
  location: "Wan Chai Promenade — 7pm sharp",
  mapsQuery: "Wan Chai Promenade, Hong Kong",
});
const memberAfterEdit = venueNotesFor("fixture-member", wntSession.id);
const actorAfterEdit = venueNotesFor("fixture-admin", wntSession.id);
const otherAfterEdit = venueNotesFor("fixture-other-admin", wntSession.id);
if (memberAfterEdit.length !== 2) {
  throw new Error("subsequent edits must re-notify members");
}
if (memberAfterEdit[0]?.title !== "Venue updated") {
  throw new Error("later shared title must be Venue updated");
}
if (actorAfterEdit.length !== 2 || actorAfterEdit[0]?.title !== "Venue updated") {
  throw new Error("acting admin must receive later shared Venue updated");
}
if (otherAfterEdit.length !== 2) {
  throw new Error("second save must notify other Admins again");
}

// Reset: audit only; preserve venueMemberNotifiedAt for title choice.
store.setWeekVenue(wntSession.id, { location: null, mapsQuery: null });
if (venueNotesFor("fixture-member", wntSession.id).length !== 2
    || venueNotesFor("fixture-admin", wntSession.id).length !== 2) {
  throw new Error("reset must not shared-notify members or actor");
}
if (venueNotesFor("fixture-other-admin", wntSession.id).length !== 3) {
  throw new Error("reset must audit other Admins");
}
if (!store.weekVenueOverride(wntSession.id)?.venueMemberNotifiedAt) {
  throw new Error("reset must preserve venueMemberNotifiedAt");
}

// Reconfirmation after reset: shared Venue updated again.
store.setWeekVenue(wntSession.id, {
  location: "Causeway Bay Promenade — 7pm sharp",
  mapsQuery: "Causeway Bay Promenade, Hong Kong",
});
if (venueNotesFor("fixture-member", wntSession.id).length !== 3) {
  throw new Error("reconfirmation after reset must shared-notify members again");
}
if (venueNotesFor("fixture-admin", wntSession.id).length !== 3) {
  throw new Error("reconfirmation after reset must shared-notify acting admin again");
}
if (venueNotesFor("fixture-other-admin", wntSession.id).length !== 4) {
  throw new Error("reconfirmation after reset must audit other Admins");
}
const latestMember = venueNotesFor("fixture-member", wntSession.id)[0];
if (latestMember?.title !== "Venue updated") {
  throw new Error("reconfirmation shared title must be Venue updated");
}
```

Note: `notificationsFor` sorts newest-first, so `[0]` is the latest row.

- [ ] **Step 4: Keep coordinate-only expectations (location/maps unchanged)**

Leave the Tamar coordinate-only block asserting members do **not** get another shared row and other admins **do** get +1 audit. Add that the actor also does not get a new shared row:

```js
const actorBeforeMove = venueNotesFor("fixture-admin", tamarSession.id).length;
// ... existing setWeekVenue coordinate change ...
if (venueNotesFor("fixture-admin", tamarSession.id).length !== actorBeforeMove) {
  throw new Error("coordinate-only edit must not shared-notify the acting admin");
}
```

- [ ] **Step 5: Run smoke and confirm the venue block fails**

Run: `node app/smoke.mjs`

Expected: FAIL on the new acting-admin / later-edit assertions (implementation still old).

- [ ] **Step 6: Commit**

```bash
git add app/smoke.mjs
git commit -m "$(cat <<'EOF'
test: expect venue inbox shared/audit fan-out

Lock the approved recipient matrix before changing setWeekVenue.
EOF
)"
```

---

### Task 2: Local `setWeekVenue` fan-out

**Files:**
- Modify: `app/js/store.js` — `setWeekVenue` notification block (~2860–2894)
- Test: `app/smoke.mjs` (from Task 1)

**Interfaces:**
- Consumes: `state.users`, `actor`, `cleared`, `confirmed`, `effectiveLocation`, `wasTBC`, `previousNotified`, `previousLocation`, `previousMapsQuery`, `cleanLocation`, `cleanMapsQuery`
- Produces: shared + audit rows matching the spec; `venueMemberNotifiedAt` set on first shared send and preserved thereafter

- [ ] **Step 1: Replace the member/admin notification block**

Inside `setWeekVenue`, after computing `destination` / `sessionLabel` and after the early `unchanged` return, replace the current once-only member loop + admin audit loop with:

```js
  const usableShared = !cleared && confirmed;
  const locationMapsChanged = previousLocation !== cleanLocation
    || previousMapsQuery !== cleanMapsQuery;
  // Shared when usable venue text changed (not coordinate-only, not reset).
  const shouldShared = usableShared && locationMapsChanged;
  const firstShared = shouldShared && !previousNotified;
  const sharedTitle = firstShared ? "Venue confirmed" : "Venue updated";

  if (shouldShared) {
    if (!previousNotified) override.venueMemberNotifiedAt = Date.now();
    const sharedBody =
      `${sessionLabel} is at ${effectiveLocation}. Check the activity page for details.`;
    const sharedRecipients = new Set();
    for (const user of state.users) {
      if (user?.status !== "approved") continue;
      if (user.role === "member" || (actor && user.id === actor.id)) {
        sharedRecipients.add(user.id);
      }
    }
    for (const userId of sharedRecipients) {
      state.notifications.push({
        id: uid("n"),
        userId,
        kind: "operational_session_venue_updated",
        title: sharedTitle,
        body: sharedBody,
        link: destination,
        read: false,
        createdAt: Date.now(),
      });
    }
  } else {
    override.venueMemberNotifiedAt = previousNotified;
  }

  const actorLabel = actor?.fullName || actor?.preferredName || actor?.email || "Admin";
  for (const user of state.users) {
    if (user?.status !== "approved") continue;
    if (user.role !== "admin" && user.role !== "superadmin" && user.role !== "super_admin") {
      continue;
    }
    if (actor && user.id === actor.id) continue;
    const body = cleared
      ? `${actorLabel} reset the venue for ${sessionId} to the activity default.`
      : `${actorLabel} set the venue for ${sessionId} to ${effectiveLocation}.`;
    state.notifications.push({
      id: uid("n"),
      userId: user.id,
      kind: "operational_session_venue_updated",
      title: "Session venue updated",
      body,
      link: destination,
      read: false,
      createdAt: Date.now(),
    });
  }
```

Remove the older assignment `override.venueMemberNotifiedAt = previousNotified` that sat before the old `if (wasTBC && …)` block so the new branch owns that field. Keep the existing `changed` / no-op early return above this block so identical saves still skip all notifies.

If `wasTBC` becomes unused after the edit, remove it only if the live-mode path above no longer needs it (live path still passes `wasTBC` into the RPC — keep that).

- [ ] **Step 2: Run smoke**

Run: `node app/smoke.mjs`

Expected: PASS, including the rewritten venue section and coordinate-only checks.

- [ ] **Step 3: Commit**

```bash
git add app/js/store.js
git commit -m "$(cat <<'EOF'
fix: fan out venue inbox to members and acting admin

Later usable edits re-notify with Venue updated; other admins keep audit.
EOF
)"
```

---

### Task 3: Failing live SQL recipient assertions

**Files:**
- Modify: `supabase/tests/operational_backend_integration.sql` (~3738–3875)

**Interfaces:**
- Consumes: `public.set_session_venue`, fixtures `v_admin` (actor), `v_super` (other admin), `v_member_a/b/c`, `v_pending`, `v_session`
- Produces: assertions that fail against the current once-only / actor-excluded RPC

- [ ] **Step 1: Update first-confirmation assertions**

Replace the block that asserts actor exclusion with:

```sql
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_session
         and profile_id in (v_member_a, v_member_b, v_member_c)) = 3,
    'first confirmation notifies approved members once'
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_session
         and profile_id = v_admin
         and title = 'Venue confirmed'
         and body = 'Wednesday Night Training on 2026-08-19 is at Central Harbourfront — 7pm sharp. Check the activity page for details.'
    ),
    'acting admin receives shared Venue confirmed'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_session
         and profile_id = v_super
         and title = 'Session venue updated') = 1,
    'other admins receive audit notification'
  );
  perform pg_temp.op_assert(
    not exists (select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_session
         and profile_id = v_pending),
    'pending profiles are excluded'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_session
         and profile_id = v_admin
         and title = 'Session venue updated') = 0,
    'acting admin does not also receive audit'
  );
```

Keep the existing member body / admin audit body copy assertions. Update the aggregate count assertion to:

```sql
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_session)
      = (select count(*) from public.profiles where role = 'member')
        + 1  -- acting admin shared
        + (select count(*) from public.profiles
            where role in ('admin', 'super_admin') and id <> v_admin),
    'members + acting admin shared + other admins audit'
  );
```

- [ ] **Step 2: Update subsequent-edit / reset / reconfirm deltas**

```sql
  -- Subsequent edit: shared to all members + actor, audit to other admins.
  select count(*) into v_initial_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform public.set_session_venue(
    v_session,
    'Wan Chai Promenade — 7pm sharp',
    'Wan Chai Promenade, Hong Kong',
    false
  );
  select count(*) into v_after_edit_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform pg_temp.op_assert(
    v_after_edit_count - v_initial_count
      = (select count(*) from public.profiles where role = 'member')
        + 1
        + (select count(*) from public.profiles
            where role in ('admin', 'super_admin') and id <> v_admin),
    'second save shared-notifies members+actor and audits other admins'
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and profile_id = v_member_a
         and title = 'Venue updated'
         and body like 'Wednesday Night Training on 2026-08-19 is at Wan Chai Promenade%'
    ),
    'later edit uses Venue updated shared title'
  );

  -- No-op unchanged (keep existing equality assert).

  -- Reset: audit only; preserve member_notified_at for title choice.
  select member_notified_at into v_member_notified_at
    from public.operational_session_venue_overrides where session_id = v_session;
  select count(*) into v_initial_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform public.set_session_venue(v_session, null, null, false);
  select count(*) into v_after_reset_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform pg_temp.op_assert(
    v_after_reset_count - v_initial_count
      = (select count(*) from public.profiles
          where role in ('admin', 'super_admin') and id <> v_admin),
    'reset fans out only to other admins'
  );
  perform pg_temp.op_assert(
    (select member_notified_at from public.operational_session_venue_overrides where session_id = v_session)
      = v_member_notified_at,
    'reset preserves member_notified_at for confirmed vs updated titles'
  );

  -- Reconfirmation after reset: shared again as Venue updated.
  perform public.set_session_venue(
    v_session,
    'Causeway Bay Promenade — 7pm sharp',
    'Causeway Bay Promenade, Hong Kong',
    false
  );
  select count(*) into v_after_reconfirm_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform pg_temp.op_assert(
    v_after_reconfirm_count - v_after_reset_count
      = (select count(*) from public.profiles where role = 'member')
        + 1
        + (select count(*) from public.profiles
            where role in ('admin', 'super_admin') and id <> v_admin),
    'reconfirmation after reset shared-notifies members+actor and audits other admins'
  );
```

- [ ] **Step 3: Commit the failing live expectations**

```bash
git add supabase/tests/operational_backend_integration.sql
git commit -m "$(cat <<'EOF'
test: expect live venue fan-out for members and actor

Align operational SQL coverage with the approved inbox split.
EOF
)"
```

---

### Task 4: Forward migration for `set_session_venue`

**Files:**
- Create: `supabase/migrations/20260924000001_venue_inbox_fanout.sql`
- Test: `supabase/tests/operational_backend_integration.sql` via `supabase/tests/verify_operational_backend.sh` when available; also add a smoke structural check that the new migration contains the shared-recipient markers if the suite already pattern-matches venue migrations

**Interfaces:**
- Consumes: existing override table, `operational_assert_admin`, advisory lock pattern from `20260829000006_lunch_venue_meeting_point_rpc.sql`
- Produces: replaced six-arg function + restored four-arg wrapper; `notify pgrst, 'reload schema'`

- [ ] **Step 1: Create the migration**

Copy the current six-argument function body from `supabase/migrations/20260829000006_lunch_venue_meeting_point_rpc.sql` into `20260924000001_venue_inbox_fanout.sql`, then change only the notification section to:

```sql
  v_destination := '#/activity/' || v_session_id;
  v_session_label := case v_activity_id
    when 'wnt' then 'Wednesday Night Training'
    when 'run' then 'ITC Run Club'
    when 'water' then 'ITC Swimming'
    when 'lunch' then 'Post-Training Lunch'
  end || ' on ' || substring(v_session_id from '([0-9]{4}-[0-9]{2}-[0-9]{2})$');

  -- Shared when usable location+maps changed (not identical re-save; not reset).
  v_should_notify_members :=
    v_location is not null
    and upper(v_location) <> 'TBC'
    and v_maps_query is not null
    and upper(v_maps_query) <> 'TBC'
    and (
      v_existing.session_id is null
      or v_existing.location is distinct from v_location
      or v_existing.maps_query is distinct from v_maps_query
    );

  if v_should_notify_members then
    update public.operational_session_venue_overrides
       set member_notified_at = coalesce(member_notified_at, now())
     where session_id = v_session_id
     returning * into v_saved;

    insert into public.notifications (profile_id, kind, title, body, destination)
    select p.id,
           'operational_session_venue_updated',
           case
             when v_existing.member_notified_at is null then 'Venue confirmed'
             else 'Venue updated'
           end,
           format('%s is at %s. Check the activity page for details.',
                  v_session_label, v_location),
           v_destination
      from public.profiles p
     where p.role = 'member'
        or p.id = v_actor;
  end if;

  insert into public.notifications (profile_id, kind, title, body, destination)
  select p.id,
         'operational_session_venue_updated',
         'Session venue updated',
         case
           when v_location is null and v_maps_query is null then
             format('%s reset the venue for %s to the activity default.',
                    v_actor_label, v_session_id)
           else
             format('%s set the venue for %s to %s.',
                    v_actor_label, v_session_id,
                    coalesce(v_location, 'the activity default'))
         end,
         v_destination
    from public.profiles p
   where p.role in ('admin', 'super_admin')
     and p.id <> v_actor;

  return v_saved;
```

Important: evaluate the shared title using **`v_existing.member_notified_at`** (pre-update), then `coalesce(member_notified_at, now())` so the first shared sets the stamp and later shared keeps “Venue updated”.

Retain the rest of the function unchanged (validation, lock, upsert, early no-op when `not v_changed`). Append the four-argument wrapper + grants + `notify pgrst` exactly as in `00006`.

Header comment:

```sql
-- Island Training Club — venue inbox shared/audit fan-out
--
-- Shared Venue confirmed/updated goes to all members plus the acting admin.
-- Audit Session venue updated goes to other admins only. Later usable edits
-- re-notify; identical location/maps skips shared; blank reset is audit-only.
```

- [ ] **Step 2: Run live verification if available**

Run: `bash supabase/tests/verify_operational_backend.sh`

Expected: PASS venue recipient assertions. If the harness is unavailable in this environment, note that in the PR and rely on CI / local Supabase.

- [ ] **Step 3: Re-run local smoke**

Run: `node app/smoke.mjs`  
Expected: PASS

- [ ] **Step 4: Whitespace check**

Run: `git diff --check`  
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260924000001_venue_inbox_fanout.sql
git commit -m "$(cat <<'EOF'
feat: shared venue inbox for members and acting admin

Forward set_session_venue so later edits re-notify; other admins keep audit.
EOF
)"
```

---

### Task 5: Spec status + PR prep

**Files:**
- Modify: `docs/superpowers/specs/2026-09-24-venue-inbox-fanout-design.md` (status already Approved; add plan link if missing)
- Create: this plan file is already at `docs/superpowers/plans/2026-09-24-venue-inbox-fanout.md`

- [ ] **Step 1: Link plan from the spec**

Add under the header:

```markdown
**Plan:** `docs/superpowers/plans/2026-09-24-venue-inbox-fanout.md`
```

- [ ] **Step 2: Commit docs**

```bash
git add docs/superpowers/specs/2026-09-24-venue-inbox-fanout-design.md \
        docs/superpowers/plans/2026-09-24-venue-inbox-fanout.md
git commit -m "$(cat <<'EOF'
docs: venue inbox fan-out spec and plan

EOF
)"
```

- [ ] **Step 3: Open PR into `main` when implementation is green** (human or follow-up)

```bash
git push -u origin HEAD
gh pr create --base main --title "Venue inbox shared/audit fan-out" --body "$(cat <<'EOF'
## Summary
- Shared Venue confirmed/updated to all members + acting admin
- Audit Session venue updated to other admins only
- Later usable venue edits re-notify members

## Test plan
- [ ] `node app/smoke.mjs`
- [ ] `bash supabase/tests/verify_operational_backend.sh` (or CI equivalent)
- [ ] Manual: as admin, confirm TBC venue → see shared inbox; edit venue → see Venue updated; second admin sees audit only

EOF
)"
```

---

## Spec coverage self-check

| Spec requirement | Task |
|---|---|
| Shared to members + acting admin | 1, 2, 3, 4 |
| Audit to other admins only | 1, 2, 3, 4 |
| Same split first confirm + later edits | 1–4 |
| Venue confirmed vs Venue updated titles | 1, 2, 4 |
| Later edits re-notify members | 1–4 |
| `member_notified_at` for title, not suppress later | 2, 4 |
| Skip shared on identical location/maps | 1 (coord-only), 2, 4 |
| Reset audit-only, no shared | 1–4 |
| Kind + `#/activity/...` destination | unchanged / 4 |
| Local shape preserved | 1 (existing assert) |
| Forward migration only | 4 |
| Announcements out of scope | Global Constraints |
| Branch off `main` | Task 1 |

## Placeholder scan

No TBD/TODO left in task steps. SQL and JS snippets are copy-pasteable. Live verify may be environment-gated; Task 4 Step 2 documents that explicitly.
