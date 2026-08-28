# Generic Social Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Community feature card link directly to the earliest Socials event whose start time falls within the next seven days, using generic event copy.

**Architecture:** Add `store.nextSocialSession()` as the single selection seam. First make `upcomingSessions(days)` honor its requested source window for all live sessions without truncating valid results; then read an eight-day source window, filter sessions to the rolling `[now, now + 7 days]` start-time interval and `category === "Socials"`. `communityHome()` will render the selected event and direct activity link, with a Schedule fallback when no result exists.

**Tech Stack:** Vanilla ES modules, hand-rendered HTML templates, localStorage-backed store, existing Node smoke tests.

## Global Constraints

- Keep the implementation on `feature/rsvp-events`.
- Include all sessions categorized `Socials`, including recurring RSVP sessions and one-off socials.
- Follow a rolling seven-day event-start window: from the current local Hong Kong time through seven days from now.
- Include a not-yet-started event today and skip an event whose start time has passed, even if it is today.
- Use existing local Hong Kong date helpers and existing date/time ordering.
- Preserve `aria-labelledby="next-connection-title"` and escape dynamic event content with existing view helpers.
- Do not add dependencies, a build step, a migration, or a second event data source.
- Run `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, and `git diff --check` before declaring the change complete.

---

### Task 1: Add the rolling 7-day Socials selector

**Files:**
- Modify: `app/js/store.js` in the live `upcomingSessions(days)` branch and near `nextSession()`
- Test: `app/smoke.mjs` in the Community/schedule smoke coverage

**Interfaces:**
- Produces: `export function nextSocialSession()` returning the earliest matching session object or `null`.
- Consumes: `upcomingSessions(8)`, which merges local/live sessions and sorts by `dateISO` and `time`; Task 1 also makes its live source window accurate without truncation.

- [ ] **Step 1: Write the failing selector test**

After resetting local state and installing fixtures, sign in as the local admin and create these one-off events with `store.createOneOffEvent()`:

```js
const today = data.todayLocal();
const datePlus = (days) => data.isoDate(data.addDays(today, days));
await store.createOneOffEvent({
  name: "Already Started Social",
  dateISO: datePlus(0),
  time: "00:00",
  durationMin: 90,
  location: "Central",
  mapsQuery: "Central, Hong Kong",
  category: "Socials",
  price: 0,
  capacity: 20,
});
const earliestSocial = await store.createOneOffEvent({
  name: "Community Breakfast",
  dateISO: datePlus(1),
  time: "08:00",
  durationMin: 90,
  location: "Central",
  mapsQuery: "Central, Hong Kong",
  category: "Socials",
  price: 0,
  capacity: 20,
});
await store.createOneOffEvent({
  name: "Community Dinner",
  dateISO: datePlus(2),
  time: "19:00",
  durationMin: 90,
  location: "Wan Chai",
  mapsQuery: "Wan Chai, Hong Kong",
  category: "Socials",
  price: 0,
  capacity: 20,
});
await store.createOneOffEvent({
  name: "Strength Workshop",
  dateISO: datePlus(1),
  time: "07:00",
  durationMin: 60,
  location: "Central",
  mapsQuery: "Central, Hong Kong",
  category: "Strength",
  price: 0,
  capacity: 20,
});
await store.createOneOffEvent({
  name: "Next Month Social",
  dateISO: datePlus(7),
  time: "08:00",
  durationMin: 90,
  location: "Central",
  mapsQuery: "Central, Hong Kong",
  category: "Socials",
  price: 0,
  capacity: 20,
});
const nextSocial = store.nextSocialSession();
if (!nextSocial || nextSocial.id !== earliestSocial.id) {
  throw new Error("nextSocialSession should select the earliest not-started Socials event within the rolling seven-day window");
}
```

- [ ] **Step 2: Run the focused smoke test and verify it fails**

Run: `node app/smoke.mjs`

Expected: FAIL because `store.nextSocialSession` is not defined.

- [ ] **Step 3: Make the shared live source window accurate and implement the selector**

In the live branch of `upcomingSessions(days)`, derive the source end date from `addDays(todayLocal(), days)`, keep live sessions with `dateISO >= todayISO && dateISO < endISO`, and remove the `.slice(0, days * 2)` truncation so a valid Socials event cannot be omitted behind other sessions. Preserve the existing date/time sort and free-session merge.

Then add this export immediately after `nextSession()` in `app/js/store.js`, using the existing `parseISO` helper to compare local event start timestamps:

```js
export function nextSocialSession() {
  const now = Date.now();
  const latest = now + 7 * 24 * 60 * 60 * 1000;
  return upcomingSessions(8).find((session) => {
    if (session.category !== "Socials") return false;
    const start = parseISO(session.dateISO);
    const [hours, minutes] = String(session.time || "").split(":").map(Number);
    start.setHours(hours, minutes, 0, 0);
    const startMs = start.getTime();
    return startMs >= now && startMs <= latest;
  }) ?? null;
}
```

The eight-day source includes the next calendar Saturday when today’s event has already started; the timestamp filter then implements the rolling seven-day boundary. Existing chronological ordering ensures the first match is earliest.

- [ ] **Step 4: Run the smoke test and verify it passes**

Run: `node app/smoke.mjs`

Expected: PASS, including the new selector assertions.

- [ ] **Step 5: Commit the selector**

```bash
git add app/js/store.js app/smoke.mjs
git commit -m "feat(community): select the next social this week"
```

---

### Task 2: Make the Community card generic and directly navigable

**Files:**
- Modify: `app/js/views.js` in `communityHome()`
- Test: `app/smoke.mjs` in the existing Community card assertions

**Interfaces:**
- Consumes: `store.nextSocialSession()` from Task 1 and existing `fmtDate()`/`esc()` view helpers.
- Produces: A Community feature card with generic copy, optional selected-event detail, direct `#/activity/<session-id>` navigation, and a `#/schedule` fallback.

- [ ] **Step 1: Replace the old lunch-specific smoke assertions with failing generic-card assertions**

Update the existing required Community markers so they expect the approved copy instead of `Post-training lunch` and `See the next lunch`:

```js
for (const required of [
  "Next connection",
  "Connect beyond training",
  "Meet up, share a meal, and find your people.",
  "View next social",
  "Latest from ITC",
  "Island Training Club turns 2",
  "Ways to connect",
  "Explore",
]) {
  if (!commHtml.includes(required)) {
    failures++;
    console.error(`FAIL Community Pulse missing ${required}`);
  }
}
if (commHtml.includes("Post-training lunch") || commHtml.includes("Every Saturday after HYROX")
    || commHtml.includes("See the next lunch")) {
  failures++;
  console.error("FAIL Community Pulse should not use lunch-specific preview copy");
}
```

Add assertions using the Socials fixture from Task 1:

```js
const selectedSocial = store.nextSocialSession();
if (!commHtml.includes(`Next up: ${selectedSocial.name}`)
    || !commHtml.includes(data.fmtDate(selectedSocial.dateISO))
    || !commHtml.includes(`href="#/activity/${selectedSocial.id}"`)) {
  failures++;
  console.error("FAIL Community Pulse should show and link to the next Socials event");
}
```

For the fallback branch, reset local fixtures, remove all Socials activities and one-off events from the persisted test state, reload the store, and assert the CTA points to Schedule:

```js
store.resetLocalData();
installLocalFixtures();
const fallbackState = JSON.parse(mem.get("itc.prototype.v1"));
fallbackState.activities = fallbackState.activities.filter((activity) => activity.category !== "Socials");
fallbackState.oneOffEvents = [];
mem.set("itc.prototype.v1", JSON.stringify(fallbackState));
store.load();
const fallbackCommunity = views.viewCommunity();
if (store.nextSocialSession() !== null || !fallbackCommunity.includes('href="#/schedule"')) {
  failures++;
  console.error("FAIL Community Pulse should fall back to Schedule when no Socials event starts within seven days");
}
store.resetLocalData();
installLocalFixtures();
```

- [ ] **Step 2: Run the smoke test and verify it fails**

Run: `node app/smoke.mjs`

Expected: FAIL because the Community card still has lunch-specific text and links to Schedule rather than the selected activity.

- [ ] **Step 3: Implement the generic card rendering**

At the start of `communityHome()`, read the selector and derive the destination/detail:

```js
const nextSocial = store.nextSocialSession();
const socialHref = nextSocial ? `#/activity/${nextSocial.id}` : "#/schedule";
const socialDetail = nextSocial
  ? `<p class="muted small mt8">Next up: ${esc(nextSocial.name)} · ${esc(fmtDate(nextSocial.dateISO))}</p>`
  : "";
```

Replace the existing feature-card content with:

```js
<section class="community-feature" aria-labelledby="next-connection-title">
  <span class="kicker">Socials</span>
  <h2 id="next-connection-title">Connect beyond training</h2>
  <p>Meet up, share a meal, and find your people.</p>
  ${socialDetail}
  <div class="community-feature-actions">
    <a class="btn sm" href="${socialHref}">View next social</a>
  </div>
</section>
```

Keep the existing section class, heading ID, and surrounding Community layout unchanged.

- [ ] **Step 4: Run the smoke test and verify it passes**

Run: `node app/smoke.mjs`

Expected: PASS, including generic copy, direct activity routing, Socials ordering, 7-day exclusion, non-Social filtering, and Schedule fallback.

- [ ] **Step 5: Commit the Community card**

```bash
git add app/js/views.js app/smoke.mjs
git commit -m "feat(community): link preview to next social"
```

---

### Task 3: Run the full verification suite

**Files:**
- Verify: `app/js/store.js`
- Verify: `app/js/views.js`
- Verify: `app/smoke.mjs`
- Verify: `app/live-auth-smoke.mjs`

- [ ] **Step 1: Check whitespace and run both suites**

Run:

```bash
git diff --check
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected:
- `git diff --check` exits successfully with no output.
- `node app/smoke.mjs` prints `All smoke tests passed.`
- `node app/live-auth-smoke.mjs` completes with its final `ok` messages and no `FAIL` output.

- [ ] **Step 2: Review the final diff and branch state**

Run:

```bash
git status --short --branch
git log -4 --oneline
```

Confirm the only implementation changes are the Socials selector, Community card rendering, and their smoke assertions, with the two design commits retained in history.
