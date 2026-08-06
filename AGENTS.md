# AGENTS.md

Working notes for AI coding agents working in this repository.
Read `README.md` and `docs/handoff.md` first for product context.

## What this repo is

A clickable, vanilla-JS prototype for the Island Training Club (Hong Kong) community web app. **Pre-production.** No real backend, no build, no framework. The `/app` directory is the prototype; the production stack is still an open decision.

The point of the prototype is to refine flows, copy, and visuals — not to ship.

## Stack

- Plain ES modules. No bundler. No npm runtime deps.
- State is held in `localStorage`; `app/js/store.js` is the single seam where a real backend will later connect.
- All UI is rendered by hand from `app/js/views.js` (string-template HTML).
- Smoke tests live in `app/smoke.mjs` and run headless with `node`.

## Repo layout

```
app/
  index.html         app shell
  styles.css
  js/
    app.js           router + click/submit delegation
    views.js         all view templates (render functions)
    store.js         state + migrations (the backend seam)
    data.js          seed data + pure helpers
  smoke.mjs          regression checks
assets/itc/          photos, logo, product shots
docs/                product brief, handoff, brainstorming notes
README.md            what the project is
```

## Agent execution policy

The model selected in the parent Pi session is the source of truth for all work. See `docs/agent-execution-policy.md` for the rationale and operating modes.

- Inline work runs in the current parent session with its selected provider, model, and reasoning level.
- Subagents are allowed when useful, but every child must use the parent's exact `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL` values.
- Never choose a different child model or reasoning level based on cost, speed, task complexity, review role, retries, or fix-loop escalation.
- Before dispatching a child, read the current `PI_*` values from the shell environment and pass them explicitly:

  ```sh
  pi -p --model "$PI_PROVIDER/$PI_MODEL" --thinking "$PI_REASONING_LEVEL" ...
  ```

- If any required `PI_*` value is unavailable, execute inline or ask the user; do not guess.
- A different child model or reasoning level requires the user's explicit approval for that dispatch.

## Branching model

Three long-lived branches. Agents must not collapse them.

- `main` — **non-Shop work only.** Home, Schedule, Profile, Community, Admin, identity, core flows.
- `feature/shop-page` — **Shop work only.** Giving, merchandise, product imagery, anything tied to the Shop tab.
- `development` — integration branch (rarely used).

The Shop split is a hard rule. If a non-Shop change accidentally touches Shop files (or vice versa), the change is wrong. Active Shop code lives only on `feature/shop-page`. If you find Shop code on `main`, remove it.

When creating a new branch:
- Forgiving Product / Shop / Giving / merchandise → `feature/shop-page`
- Anything else → base on `main`

## Local dev

```sh
python3 -m http.server 4173
# then open http://127.0.0.1:4173/app/
```

Manual smoke check after every change:

```sh
node app/smoke.mjs
```

All tests must pass before declaring done. The smoke suite covers the product rules (free vs paid, booking, donor ID, indemnity, Profile sub-pages, leader approval, localStorage migrations). It runs in milliseconds; no excuses.

## Demo accounts

Sign-in is frictionless (no password). Use these emails or one-tap demo profiles on the Account screen:

- `member@itc.hk` — approved member
- `admin@itc.hk` — admin (approves applications)
- `owner@itc.hk` — super admin (changes roles)

The full loop to try: apply → sign out → sign in as admin → approve → sign back in → book HYROX → see receipt.

## The Store.js seam

`app/js/store.js` is the only place that touches `localStorage`. Two non-obvious rules:

1. **Never delete `state` keys without a migration.** Persisted state has a `version` field; bump `STATE_VERSION` and add a migration step in `migrate()` instead of removing data outright.
2. **Seed data is read-only.** Admin edits live in `state`, not in `SEED_*` constants. Resetting demo data must rebuild `state` from the seeds.

## Things deliberately NOT in the prototype

Don't accidentally build these into the prototype:

- Real payments (the card form is a stub — any number works)
- Real email / notifications
- A service worker / cache layer (would fight the refinement loop)
- Production-ready waiver / privacy / guidelines copy
- A real backend

When in doubt: is this a real product feature, or a prototype affordance? If the latter, keep it small and clearly mocked.

## Common pitfalls

- **Don't add Shop code to `main`.** The branch split is the source of truth — feature work belongs on the right branch.
- **Don't break localStorage migrations.** Bump `STATE_VERSION` and add a migration step. Snapshots in `state.bookings` reference seed activity fields by name; renaming them silently breaks old persisted data.
- **Title-cased headings on Profile sub-pages.** "Membership Details", "Donor Profile", "Payments & Receipts", "Privacy & Notifications" — "History" stays single-word.
- **"My Week" on Home is signed-in-only and shows booked sessions.** Visitors see the upcoming preview, not "My Week".
- **The Wednesday Night Training session is free.** No booking, no checkout, no capacity. Actions are Add to Calendar and Get Directions.
- **The smoke test is the contract.** When you change product behaviour, update the test in the same commit. Don't leave the test failing.

## Style

- Vanilla JS, no transpilation. Use `const`/`let`, arrow functions, template literals, optional chaining.
- New view functions go in `views.js` as `export function viewX()` returning a string.
- New state actions go in `store.js` as `export function actionX()` returning the new state.
- New seed data goes in `data.js`. Anything admin-mutable lives in `state`, not in seeds.
- Keep CSS class names consistent with the existing palette (`.card`, `.kicker`, `.badge`, `.display`, `.btn`, `.muted`, `.section-head`).

## Out of scope for agents

- Don't add npm dependencies.
- Don't introduce a build step.
- Don't restructure the repo layout.
- Don't replace `views.js` with a framework.
- Don't change the localStorage shape without a migration.
