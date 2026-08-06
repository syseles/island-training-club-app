# Community Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Community landing page’s uniform link list with a personalized Community Pulse and replace all placeholder announcements with one engaging ITC second-anniversary story.

**Architecture:** Keep the existing vanilla-JS boundaries: immutable editorial seed content in `data.js`, HTML render functions in `views.js`, delegated prototype actions in `app.js`, and scoped presentation in `styles.css`. Extend the announcement seed record with structured milestone fields so the homepage can render a concise preview while the existing Announcements route renders the full story; no persistent state changes are required.

**Tech Stack:** Plain ES modules, HTML template strings, CSS, localStorage-backed prototype state, Node smoke tests.

## Global Constraints

- Work only on `feature/community-page`, based on `main`; do not touch Shop or Giving files.
- Keep the app dependency-free with no build step or framework.
- Visitor heading: **“Find your place in the crew.”**
- Pending applicant heading: **“You’re welcome here.”**
- Approved member heading: **“Connect and grow with us.”**
- Keep only the August 6, 2026 announcement titled **“Island Training Club turns 2.”**
- Preserve the supplied anniversary facts and messages; do not add fake participation, activity, or unread counts.
- Reuse the existing Community routes, prayer form, and mocked `connect-interest` action.
- Do not change the localStorage shape or `STATE_VERSION`.
- Use Community-scoped CSS and preserve accessible link/button semantics and focus states.
- Run `node app/smoke.mjs` after every production change.

---

## File Structure

- Modify `app/js/data.js`: replace the three draft announcement seeds with one structured anniversary record.
- Modify `app/js/views.js`: personalize the Community heading, render the Community Pulse hierarchy, and render the full anniversary story.
- Modify `app/styles.css`: style the Community Pulse and anniversary story responsively without changing shared Profile cards.
- Modify `app/smoke.mjs`: cover the approved seed, personalized states, Community destinations/actions, full story, and empty-announcement fallback.

### Task 1: Approved anniversary seed

**Files:**
- Modify: `app/js/data.js:258-277`
- Test: `app/smoke.mjs:after store.load()`

**Interfaces:**
- Consumes: the existing exported mutable array `ANNOUNCEMENTS`.
- Produces: one announcement object with fields `id`, `title`, `postedAt`, `lead`, `milestones`, `body`, and `commitment`; `milestones` is an array of `{ value: string, label: string }`.

- [ ] **Step 1: Add failing seed assertions**

Immediately after `store.load();` in `app/smoke.mjs`, add:

```js
const anniversary = data.ANNOUNCEMENTS[0];
if (
  data.ANNOUNCEMENTS.length !== 1 ||
  anniversary?.title !== "Island Training Club turns 2" ||
  anniversary?.milestones?.length !== 5
) {
  failures++;
  console.error("FAIL announcement seeds should contain only the structured ITC anniversary");
} else console.log("ok  announcement seeds contain only the ITC anniversary");

for (const oldTitle of [
  "Sunday service at IECC",
  "New Wednesday venue being scouted",
  "Marathon fundraiser passes first milestone",
]) {
  if (data.ANNOUNCEMENTS.some((item) => item.title === oldTitle)) {
    failures++;
    console.error(`FAIL old announcement seed remains: ${oldTitle}`);
  }
}
```

- [ ] **Step 2: Run the smoke test and verify RED**

Run:

```bash
node app/smoke.mjs
```

Expected: FAIL with `announcement seeds should contain only the structured ITC anniversary` because three unstructured placeholder records still exist.

- [ ] **Step 3: Replace the announcement seed records**

Replace `ANNOUNCEMENTS` in `app/js/data.js` with:

```js
export const ANNOUNCEMENTS = [
  {
    id: "ann-itc-turns-2",
    title: "Island Training Club turns 2",
    postedAt: new Date(2026, 7, 6, 12).getTime(),
    lead: "Today, August 6, 2026 marks 2 years of Island Training Club.",
    milestones: [
      { value: "620", label: "members strong" },
      { value: "14", label: "committed leaders" },
      { value: "1", label: "unwavering vision" },
      { value: "1", label: "clear mission" },
      { value: "1", label: "God who made this all possible" },
    ],
    body: "On behalf of the ITC Leadership and Coaching Team, we are blessed to share this journey with you! We should all be proud of how far we’ve come and look forward to much more 👊",
    commitment: "We will continue our commitment to serve our God and this community, doing our best to create and maintain a space where you grow in fitness, friendship, community and faith.",
  },
];
```

The local-noon timestamp ensures the intended calendar date renders as August 6 in the prototype’s Hong Kong context.

- [ ] **Step 4: Run the smoke test and verify GREEN**

Run:

```bash
node app/smoke.mjs
```

Expected: all smoke tests pass and output includes `ok  announcement seeds contain only the ITC anniversary`.

- [ ] **Step 5: Commit the seed replacement**

```bash
git add app/js/data.js app/smoke.mjs
git commit -m "feat(community): add second anniversary announcement"
```

### Task 2: Personalized Community Pulse homepage

**Files:**
- Modify: `app/js/views.js:407-419`
- Modify: `app/styles.css:905-914`
- Test: `app/smoke.mjs:visitor Community block, pending block, approved-member block`

**Interfaces:**
- Consumes: `store.currentUser()`, `ANNOUNCEMENTS[0]`, `ICONS.heart`, `ICONS.people`, and existing `connect-interest` delegation.
- Produces: private `communityHeading(user)` returning a string and `communityHome()` returning the complete Community Pulse HTML string.

- [ ] **Step 1: Add failing personalization and hierarchy assertions**

After `const commHtml = views.viewCommunity();` in the visitor block, add:

```js
if (!commHtml.includes("Find your place in the crew.")) {
  failures++;
  console.error("FAIL visitor Community heading is not personalized");
} else console.log("ok  visitor Community heading is personalized");

for (const required of [
  "Next connection",
  "Post-training dinner",
  "Count me in",
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
if (!commHtml.includes('data-action="connect-interest"')) {
  failures++;
  console.error("FAIL Community Pulse meal CTA should use the existing interest action");
}
```

After `check("account (pending)", () => views.viewAccount());`, add:

```js
const pendingCommunity = views.viewCommunity();
if (!pendingCommunity.includes("You’re welcome here.")) {
  failures++;
  console.error("FAIL pending Community heading is not personalized");
} else console.log("ok  pending Community heading is personalized");
```

After `check("account (new member)", () => views.viewAccount());`, add:

```js
const approvedCommunity = views.viewCommunity();
if (!approvedCommunity.includes("Connect and grow with us.")) {
  failures++;
  console.error("FAIL approved Community heading is not personalized");
} else console.log("ok  approved Community heading is personalized");
```

Keep the existing loop that verifies all five Community destination links. Replace the old About-card subtext assertion with an assertion that `#/community/about` remains present, because the redesigned compact Explore link no longer carries “Mission, coaches and leadership” on its face.

- [ ] **Step 2: Run the smoke test and verify RED**

Run:

```bash
node app/smoke.mjs
```

Expected: visitor and pending heading assertions fail, and the new Community Pulse hierarchy assertions fail because `communityHome()` still renders the five uniform link cards.

- [ ] **Step 3: Implement personalized heading and Community Pulse markup**

Replace `communityHome()` and add the heading helper directly above it:

```js
function communityHeading(user) {
  if (!user) return "Find your place in the crew.";
  if (user.status === "pending") return "You’re welcome here.";
  if (user.status === "approved") return "Connect and grow with us.";
  return "Find your place in the crew.";
}

function communityHome() {
  const user = store.currentUser();
  const announcement = ANNOUNCEMENTS[0];
  return `
    <div class="community-pulse">
      <div class="kicker">Community</div>
      <h1 class="display">${esc(communityHeading(user))}</h1>
      <p class="subcopy mt8">Island Training Club is a Hong Kong training community with a Christian foundation — open to everyone. Training is the doorway; find your next way to connect.</p>

      <section class="community-feature" aria-labelledby="next-connection-title">
        <span class="kicker">Next connection</span>
        <h2 id="next-connection-title">Post-training dinner</h2>
        <p>Date and venue are announced in the session WhatsApp group a few days ahead.</p>
        <div class="community-feature-actions">
          <button class="btn sm" type="button" data-action="connect-interest" data-topic="the next ad-hoc meal">Count me in</button>
          <a class="btn ghost sm" href="#/community/meals">View details</a>
        </div>
      </section>

      <div class="community-section-head">
        <h2>Latest from ITC</h2>
        <a href="#/community/announcements">All announcements →</a>
      </div>
      ${announcement ? `
        <a class="community-announcement-preview" href="#/community/announcements">
          <span class="kicker dim">${esc(fmtDay(announcement.postedAt))} · ITC Anniversary</span>
          <h3>${esc(announcement.title)}</h3>
          <p>${esc(announcement.lead)}</p>
        </a>` : `
        <div class="community-announcement-preview empty">No announcements yet.</div>`}

      <div class="community-section-head"><h2>Ways to connect</h2></div>
      <div class="community-action-grid">
        <a class="community-action-card" href="#/community/prayers">
          <span class="community-action-icon">${ICONS.heart}</span>
          <h3>Prayer</h3>
          <p>Share privately with our leaders.</p>
        </a>
        <a class="community-action-card" href="#/community/fellowship">
          <span class="community-action-icon">${ICONS.people}</span>
          <h3>Fellowship</h3>
          <p>Small groups and community life.</p>
        </a>
      </div>

      <div class="community-section-head"><h2>Explore</h2></div>
      <nav class="community-explore" aria-label="Explore the ITC community">
        <a href="#/community/meals">Meals</a>
        <a href="#/community/announcements">Announcements</a>
        <a href="#/community/about">About ITC</a>
      </nav>
    </div>`;
}
```

- [ ] **Step 4: Add scoped responsive homepage styles**

Under `/* ---- Community ---- */` in `app/styles.css`, add concrete styles for the classes introduced above:

```css
.community-feature {
  margin-top: 24px;
  padding: 20px;
  border: 1px solid #34462b;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, #17240f, var(--surface) 68%);
}
.community-feature h2 { margin: 8px 0 5px; font-size: 22px; line-height: 1.1; }
.community-feature p,
.community-announcement-preview p,
.community-action-card p { margin: 0; color: var(--muted); font-size: 12px; }
.community-feature-actions { display: flex; gap: 8px; margin-top: 18px; }
.community-feature-actions .btn { text-decoration: none; }
.community-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 26px 2px 10px;
}
.community-section-head h2 { margin: 0; font-size: 15px; }
.community-section-head a { color: var(--accent); font-size: 10px; font-weight: 800; text-decoration: none; }
.community-announcement-preview,
.community-action-card {
  display: block;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: inherit;
  text-decoration: none;
}
.community-announcement-preview h3,
.community-action-card h3 { margin: 6px 0 5px; }
.community-announcement-preview:hover,
.community-action-card:hover,
.community-explore a:hover { border-color: var(--muted); }
.community-action-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.community-action-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-bottom: 14px;
  border-radius: 9px;
  background: #1d2d16;
  color: var(--accent);
}
.community-action-icon svg { width: 18px; height: 18px; }
.community-explore { display: flex; flex-wrap: wrap; gap: 8px; }
.community-explore a {
  padding: 9px 13px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink);
  font-size: 10px;
  font-weight: 800;
  text-decoration: none;
}
.community-pulse a:focus-visible,
.community-pulse button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
@media (max-width: 380px) {
  .community-action-grid { grid-template-columns: 1fr; }
  .community-feature-actions { align-items: stretch; flex-direction: column; }
}
```

- [ ] **Step 5: Run the smoke test and verify GREEN**

Run:

```bash
node app/smoke.mjs
```

Expected: all tests pass, including visitor, pending, and approved headings; all five Community links; the meal CTA; and anniversary preview content.

- [ ] **Step 6: Commit the Community Pulse homepage**

```bash
git add app/js/views.js app/styles.css app/smoke.mjs
git commit -m "feat(community): add personalized community pulse"
```

### Task 3: Full anniversary story and empty state

**Files:**
- Modify: `app/js/views.js:508-525`
- Modify: `app/styles.css:Community section`
- Test: `app/smoke.mjs:Community subpage assertions`

**Interfaces:**
- Consumes: the structured `ANNOUNCEMENTS` record from Task 1 and `fmtDay()`/`esc()` from `views.js`.
- Produces: `communityAnnouncements()` rich story markup and safe empty markup when `ANNOUNCEMENTS` has no records.

- [ ] **Step 1: Add failing story and empty-state assertions**

After `check("community > announcements", ...)` in `app/smoke.mjs`, add:

```js
const announcementHtml = views.viewCommunity("announcements");
for (const required of [
  "Island Training Club turns 2",
  "620",
  "members strong",
  "14",
  "committed leaders",
  "unwavering vision",
  "clear mission",
  "God who made this all possible",
  "ITC Leadership and Coaching Team",
  "fitness, friendship, community and faith",
]) {
  if (!announcementHtml.includes(required)) {
    failures++;
    console.error(`FAIL anniversary story missing ${required}`);
  }
}
for (const removed of [
  "Sunday service at IECC",
  "New Wednesday venue being scouted",
  "Marathon fundraiser passes first milestone",
]) {
  if (announcementHtml.includes(removed)) {
    failures++;
    console.error(`FAIL announcements page still renders ${removed}`);
  }
}

const savedAnnouncements = [...data.ANNOUNCEMENTS];
data.ANNOUNCEMENTS.splice(0);
const emptyCommunity = views.viewCommunity();
const emptyAnnouncements = views.viewCommunity("announcements");
data.ANNOUNCEMENTS.push(...savedAnnouncements);
if (!emptyCommunity.includes("No announcements yet") || !emptyAnnouncements.includes("No announcements yet")) {
  failures++;
  console.error("FAIL Community announcement empty states should render safely");
} else console.log("ok  Community announcement empty states render safely");
```

- [ ] **Step 2: Run the smoke test and verify RED**

Run:

```bash
node app/smoke.mjs
```

Expected: FAIL for milestone and empty-state assertions because the existing announcement renderer only expects `title` and `body`, and renders an empty `.stack` when no records exist.

- [ ] **Step 3: Render the full anniversary story**

Replace `communityAnnouncements()` with:

```js
function communityAnnouncements() {
  const announcement = ANNOUNCEMENTS[0];
  if (!announcement) {
    return `
      <a class="back-link" href="#/community">← Community</a>
      <div class="kicker mt16">Community · Announcements</div>
      <h1 class="display sm">Announcements.</h1>
      <div class="empty mt16">No announcements yet.</div>`;
  }
  return `
    <a class="back-link" href="#/community">← Community</a>
    <article class="anniversary-story">
      <div class="kicker">${esc(fmtDay(announcement.postedAt))} · ITC Anniversary</div>
      <h1 class="display sm">${esc(announcement.title)}.</h1>
      <p class="subcopy mt8">${esc(announcement.lead)}</p>
      <div class="anniversary-hero">
        <strong aria-label="2 years">2<span>yrs</span></strong>
        <div><h2>Look what God has built.</h2><p>One community, growing stronger together.</p></div>
      </div>
      <div class="milestone-grid">
        ${announcement.milestones.map((item) => `
          <div class="milestone">
            <strong>${esc(item.value)}</strong>
            <span>${esc(item.label)}</span>
          </div>`).join("")}
      </div>
      <p class="anniversary-message">${esc(announcement.body)}</p>
      <blockquote class="anniversary-commitment">${esc(announcement.commitment)}</blockquote>
    </article>`;
}
```

- [ ] **Step 4: Style the story and milestone grid**

Add under the Community styles in `app/styles.css`:

```css
.anniversary-story { margin-top: 18px; }
.anniversary-hero {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 22px;
  padding: 20px;
  border: 1px solid #34462b;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, #17240f, var(--surface) 70%);
}
.anniversary-hero > strong {
  display: grid;
  place-items: center;
  flex: 0 0 58px;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 25px;
}
.anniversary-hero > strong span { margin-left: 2px; font-size: 10px; }
.anniversary-hero h2 { margin: 0; font-size: 19px; }
.anniversary-hero p { margin: 4px 0 0; color: var(--muted); font-size: 11px; }
.milestone-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
.milestone {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.milestone:first-child { grid-column: 1 / -1; }
.milestone strong { display: block; color: var(--accent); font-size: 27px; line-height: 1; }
.milestone span { display: block; margin-top: 6px; font-size: 11px; font-weight: 800; }
.anniversary-message { margin: 22px 2px 0; color: var(--muted); line-height: 1.7; }
.anniversary-commitment {
  margin: 18px 0 0;
  padding: 17px;
  border: 0;
  border-left: 3px solid var(--accent);
  background: var(--surface);
  color: var(--ink);
  font-size: 13px;
  line-height: 1.65;
}
@media (max-width: 380px) {
  .milestone-grid { grid-template-columns: 1fr; }
  .milestone:first-child { grid-column: auto; }
  .anniversary-hero { align-items: flex-start; }
}
```

- [ ] **Step 5: Run all regression checks**

Run:

```bash
node app/smoke.mjs
git diff --check
```

Expected: all smoke tests pass, the empty-state assertion passes, and `git diff --check` prints no errors.

- [ ] **Step 6: Commit the anniversary presentation**

```bash
git add app/js/views.js app/styles.css app/smoke.mjs
git commit -m "feat(community): present anniversary milestone story"
```

### Task 4: Responsive visual verification

**Files:**
- Modify if defects are found: `app/styles.css`
- Test: browser rendering at 375px and 520px content widths

**Interfaces:**
- Consumes: completed Community Pulse and anniversary story from Tasks 2–3.
- Produces: verified responsive rendering with no horizontal overflow, clipped copy, inaccessible focus, or regressions to Profile cards.

- [ ] **Step 1: Start the prototype server**

Run from the worktree root:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/app/#/community`.

- [ ] **Step 2: Inspect visitor and authenticated states**

At 375px and 520px widths, verify:

- visitor heading reads “Find your place in the crew.”;
- pending heading reads “You’re welcome here.” after applying or signing into a pending account;
- approved heading reads “Connect and grow with us.” for `member@itc.hk`;
- every CTA is keyboard focusable and has a visible lime focus ring;
- the feature buttons, action grid, and Explore pills do not overflow;
- Profile section cards retain their original appearance.

- [ ] **Step 3: Inspect the anniversary story**

Open `http://127.0.0.1:4173/app/#/community/announcements` and verify:

- the title uses the numeral `2`;
- all five milestones are readable and not clipped;
- the emoji renders;
- the commitment callout is visually distinct;
- the page has no old draft-announcement disclaimer or placeholder post.

- [ ] **Step 4: Fix only observed responsive defects and rerun verification**

If a defect appears, first add an HTML/string smoke assertion when the defect is behavioral. Make the smallest scoped CSS/view correction, then run:

```bash
node app/smoke.mjs
git diff --check
```

Expected: all smoke tests pass and no whitespace errors are reported.

- [ ] **Step 5: Commit any visual corrections**

If Step 4 changed files:

```bash
git add app/styles.css app/js/views.js app/smoke.mjs
git commit -m "fix(community): polish responsive pulse layout"
```

If no files changed, do not create an empty commit.

### Task 5: Final verification and push

**Files:**
- Verify only; no expected production changes.

**Interfaces:**
- Consumes: all prior task commits.
- Produces: a clean, tested `feature/community-page` ready for review.

- [ ] **Step 1: Run final automated verification**

```bash
node app/smoke.mjs
git diff --check
git status --short --branch
```

Expected: smoke suite reports `All smoke tests passed.`, `git diff --check` is silent, and the branch has no uncommitted files.

- [ ] **Step 2: Confirm branch scope**

```bash
git diff --name-only main...HEAD
```

Expected files only:

```text
app/js/data.js
app/js/views.js
app/smoke.mjs
app/styles.css
docs/superpowers/plans/2026-08-06-community-pulse.md
docs/superpowers/specs/2026-08-06-community-pulse-design.md
```

- [ ] **Step 3: Push the reviewed branch**

```bash
git push origin feature/community-page
```
