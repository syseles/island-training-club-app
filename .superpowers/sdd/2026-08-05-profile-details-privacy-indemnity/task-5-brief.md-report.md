# Task 5 Report — Membership summary/edit workflow

## Status
Done.

## What changed
- `app/js/views.js`
  - Split Membership Details into a summary card at `#/account/details` and an edit form at `#/account/details/edit`.
  - Added summary rows for application-backed membership/contact data plus an Update details CTA.
  - Added `accountDetailsEdit(user, application)` with prefilled fields, age radios, conditional guardian block, and read-only full-name/email rows.
  - Removed photo-consent controls from the membership edit flow.
  - Made heard-source selects preserve existing unknown values so old application data still prefills.
- `app/js/app.js`
  - Passed `arg2` into `views.viewAccount(arg, arg2)` so edit-mode routes render.
  - Extended the age-status toggle handler to the membership edit form.
  - Added focused `data-form="membership-details"` submit handling with success toast and return navigation to `#/account/details`.
- `app/live-auth-smoke.mjs`
  - Added live summary/edit regressions for distinct details routes and prefilled form content.
- `app/smoke.mjs`
  - Added local summary/edit regressions plus source checks for the route arg and post-save hash.

## Requirement checklist
- `#/account/details` renders a summary card, not a form: verified.
- Summary shows required membership labels and age status: verified.
- Summary links to `#/account/details/edit`: verified.
- `#/account/details/edit` renders `data-form="membership-details"`: verified.
- Edit form is prefilled and keeps guardian fields conditional: verified.
- Edit form excludes photo/video consent and acceptance controls: verified.
- Successful membership save returns to `#/account/details`: verified.
- Missing live applications still show the unavailable card instead of an edit form: verified.
- Unrelated untracked files were untouched: verified.

## TDD / RED evidence
After adding the new tests first, I ran:

```sh
node app/smoke.mjs
```

Observed RED failure:

```text
Error: Live details summary missing Full name
```

This matched the expected failure: Membership Details was still rendering the old form flow instead of the new summary/edit split.

## Verification
Fresh verification after implementation:

```sh
node app/live-auth-smoke.mjs
node app/smoke.mjs
node --check app/js/views.js
node --check app/js/app.js
node --check app/smoke.mjs
node --check app/live-auth-smoke.mjs
git diff --check -- app/js/views.js app/js/app.js app/smoke.mjs app/live-auth-smoke.mjs
```

Result:
- `node app/live-auth-smoke.mjs`: pass.
- `node app/smoke.mjs`: pass (`All smoke tests passed.`).
- `node --check ...`: pass.
- `git diff --check ...`: pass.

## Self-review
- Strengths: the change is scoped to Task 5, keeps the focused store API intact, and covers both live and local flows.
- Critical issues: none found.
- Important issues: none found.
- Minor note: the select helper now preserves legacy heard-source values so older application rows still prefill cleanly.

## Scope preserved
- Worked in place on `feature/auth-identity` per the human ruling; no worktree was created.
- No Shop files, npm dependencies, build steps, or unrelated untracked files were touched.
