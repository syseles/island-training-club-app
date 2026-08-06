# Archivo Typography and Member Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Replace redundant Admin member counts/dropdowns with accessible filter chips and use readable Archivo Regular throughout the shared app.

**Architecture:** `views.js` renders view-local filter chips and `app.js` handles delegated filter actions/focus restoration. CSS/index/font assets own typography. No state schema changes.

**Tech Stack:** Vanilla ES modules, HTML/CSS, Node smoke tests

## Global Constraints

- Work on `feature/auth-identity` only.
- Produce exactly two feature commits: Members filters, then Archivo.
- Preserve monospace for technical identifiers only.
- No Giving, Shop, campaign, or Notification behavior.
- Preserve unrelated untracked files.

---

### Task 1: Replace Member Counts and Dropdowns with Filter Chips

**Files:** Modify `app/js/views.js`, `app/js/app.js`, `app/styles.css`, `app/smoke.mjs`, `app/live-auth-smoke.mjs`.

**Produces:** status/role chip groups, conditional clear action, combined view-local filters, and filter focus restoration.

- [ ] Write failing tests asserting count-summary text and native filter selects are absent; Status and Role groups render all approved labels as buttons with `data-action="admin-member-filter"`, exact values, and `aria-pressed`; Clear filters is conditional; combined query/status/role filtering remains correct; chip activation and clear reset state and restore focus.
- [ ] Run both smoke suites and confirm failure on current selects/counts.
- [ ] Remove the count interpolation from `adminMembers()` while retaining the Super Admin role-permission sentence.
- [ ] Replace status/role `<select>` controls with labeled `.admin-filter-chips` groups. Use `adminMemberFilters` as the only state source. Render `aria-pressed="true"` on active chips and a `data-filter-key`/`data-filter-value` contract. Render Clear filters only when query is non-empty or either filter is non-default.
- [ ] Add delegated click actions that update one filter or reset all three, await/render the Members view, then restore focus to the same chip (or search after clear) using a stable selector. Keep existing search input behavior.
- [ ] Add Night Circuit styles: horizontal overflow, hidden scrollbar, 8px gaps, dark surface, visible border, electric-lime active state, 44px minimum height, focus-visible compatibility, and wrapping-safe labels.
- [ ] Run smoke, syntax, and diff checks.
- [ ] Commit exactly: `feat(admin): replace member dropdowns with filter chips`.

---

### Task 2: Replace Barlow with Self-Hosted Archivo Regular

**Files:** Create `assets/fonts/archivo-latin-variable.woff2`; modify `assets/fonts/OFL-Barlow.txt` into `assets/fonts/OFL-Archivo.txt`; delete all seven `barlow*.woff2`; modify `app/index.html`, `app/styles.css`, `app/smoke.mjs`.

**Produces:** one variable Archivo face for all normal UI typography and preserved technical monospace.

- [ ] Write failing contracts asserting the Archivo asset/license/preload and `font-weight: 100 900` face; both `--font` and `--font-display` resolve to Archivo; `--font-mono` remains system monospace; no Barlow asset/declaration/preload remains.
- [ ] Run smoke and confirm the Archivo contract fails.
- [ ] Download exact pinned assets:

```bash
curl -fsSL https://fonts.gstatic.com/s/archivo/v25/k3kPo8UDI-1M0wlSV9XAw6lQkqWY8Q82sLydOxI.woff2 -o assets/fonts/archivo-latin-variable.woff2
curl -fsSL https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/OFL.txt -o assets/fonts/OFL-Archivo.txt
```

Verify WOFF2 signature `wOF2`, then delete Barlow WOFF2 files and `OFL-Barlow.txt`.
- [ ] Replace all Barlow font faces with one Archivo normal-width variable face (`font-style: normal; font-weight: 100 900; font-stretch: 100%; font-display: swap`). Set both normal/display tokens to `"Archivo", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; leave mono unchanged. Remove condensed/font-stretch declarations that visually squeeze headings.
- [ ] Update the preload to `archivo-latin-variable.woff2` with matching type/crossorigin attributes.
- [ ] Run both smoke suites, all JS syntax checks, WOFF2 signature/size checks, and `git diff --check`.
- [ ] Commit exactly: `feat(ui): use Archivo throughout the app`.

---

### Task 3: Final Verification

- [ ] Run `node app/live-auth-smoke.mjs`, `node app/smoke.mjs`, syntax checks for all JS/MJS, `git diff --check`, and status.
- [ ] Inspect `git log --oneline` and verify the two feature commits are separate and scope contains no Giving/Notification behavior.
- [ ] Do not create an empty commit.
