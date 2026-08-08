# Live Apply Flow + Draft / Save-and-Resume on `testing`

**Date:** 2026-08-08
**Branch:** `fix/testing-apply-live-and-drafts` (off `origin/testing`)
**Status:** Approved in brainstorm; implementation requires a reviewed plan

## Problem

The `testing` branch is the live Supabase-backed deployment (`krxbvgyolxvmzgysfjkj.supabase.co`), but the membership application form on it is silently broken: the submit handler in `app/js/app.js` falls through to the localStorage-only `applyForMembership()` (`store.js` ~line 382) instead of the Supabase-aware `saveMyApplication()` (~line 1620, currently unused). End result: a member submits the form, sees a success toast, and nothing reaches Supabase. Their application never appears in the admin queue; an admin who manually goes looking for it sees only a stale `profiles` row from the earlier Google sign-in (the "Awaiting application" group, with Approve/Decline disabled).

A second concern that surfaced while diagnosing the above: there is no draft / save-and-resume. A member who signs in, starts filling the form, and gets interrupted loses everything they typed and has to start over on return. The form fields, validations, and consent text are too long to expect a member to retype after any pause.

## Goals

- Port the working live apply flow from `feature/giving-page` onto `testing` so a form submission actually reaches Supabase and the admin's "Ready for review" queue.
- Add draft / save-and-resume so a member who abandons mid-form can return on the same device and pick up where they left off.
- Keep the prototype nature: same-device resume, no cross-device sync, no expiry, no service worker.

## Non-goals

- Cross-device draft sync (would need a new Supabase table + RLS).
- Draft expiry / TTL machinery.
- Service worker / offline mode.
- Shop-side work (stays on `feature/shop-page`).
- Production-ready indemnity / privacy / guidelines copy (already placeholdered until the ITC leadership workshop).

## Confirmed scope

### Part 1 — Port the live apply flow

Port these working pieces from `feature/giving-page` (verified in `git show feature/giving-page:app/js/{app,views}.js` and its history):

| Source | Change on `testing` |
|---|---|
| `viewApplyLive()` + `applyFormHtml(cu)` in `app/js/views.js` | Add. Renders the live-mode form: `mobile`, `age_over_18` radio + optional guardian fields, `heard_source` dropdown + optional `heard_detail`, `preferred_name`, three separate acceptance checkboxes (`waiver`, `privacy`, `guidelines`), and `photo_consent` checkbox. |
| `viewApply()` dispatch: `if (isLive()) return viewApplyLive();` | Replace the current direct-return of the local-mode form. |
| `if (form.dataset.form === "apply")` handler in `app/js/app.js` | Add before the existing `case "form-apply"` branch. Calls `store.saveMyApplication(payload)`, redirects to `#/home`, uses `withBusyControl` for the submit button. |
| `saveMyApplication(form)` in `app/js/store.js` | Already present on `testing`; leave as-is. |

The local-mode fallback (`applyForMembership()` and `case "form-apply"`) stays in place — local prototype use (empty `SUPABASE_URL`) keeps working. `testing` runs in live mode and uses the new path.

### Part 2 — Draft / save-and-resume

**Storage (localStorage only, per agreed design):**

- `itc.device.id` — a `crypto.randomUUID()` generated on first visit, persisted forever. One per browser profile.
- `itc.apply.draft.v1` — JSON value `{ version: 1, deviceId: <itc.device.id>, savedAt: <ms>, fields: { ...all form fields... } }`.

The draft's internal `version` field handles its own evolution. On read, a version mismatch makes `getApplyDraft()` return `null` and silently discard the stale entry — protects against form-schema drift across deploys.

**Store helpers (in `app/js/store.js`):**

```js
getApplyDraft()          // null | { version, deviceId, savedAt, fields }
saveApplyDraft(partial)  // merges partial.fields into the draft, bumps savedAt
clearApplyDraft()        // removes the localStorage entry
```

All three are pure functions over the localStorage key.

**Save trigger (debounced auto-save + indicator + explicit button):**

- Every `input` and `change` event inside the live apply form schedules a 500ms-debounced `saveApplyDraft({ fields: collectedFromForm() })`.
- Below the submit button: a small live indicator that reads `Saved at HH:MM` (locale-aware). Re-renders after each save.
- Next to the indicator: an explicit `Save draft now` button. Calls the same save path without the debounce and updates the indicator immediately.

**Resume UX (silent auto-fill + banner above form):**

- When `viewApplyLive()` mounts, it calls `getApplyDraft()`. If non-null, the live apply form pre-fills its inputs from `draft.fields` before render.
- Above the form, render a banner: `Resumed from your draft saved 2h ago. · [Discard draft]`.
- `[Discard draft]` calls `clearApplyDraft()`, clears the form inputs, removes the banner, and toasts confirmation.

**Visitor entry points (home + account):**

- `/home` visitor card: if `getApplyDraft()` is non-null, swap the "Apply to join" CTA copy to `Continue your application` and add a small `[Discard]` text link. Otherwise the existing CTA renders unchanged.
- `/account` visitor card: same swap above the Google sign-in button.

**Lifecycle (clear only on submit or Discard):**

- Draft cleared on **successful** `saveMyApplication()` (success path only; failed inserts leave the draft intact so the user can retry).
- Draft cleared on `[Discard draft]` from any of the three surfaces (above-form banner, home visitor card, account visitor card).
- Draft survives sign-in, sign-out, switching Google accounts, browser restart.
- No expiry. Single most-recent draft per device.

### Edge cases

| Case | Behavior |
|---|---|
| Old local-mode draft (`fullName`, `email`, etc.) on a device that just got the live form | On next `getApplyDraft()`, version mismatch → discarded silently. User starts fresh. |
| User signed in with `profiles` row, no `applications` row, has a draft | Form pre-fills correctly. Resume banner shows. |
| Two browser tabs on the same device | Last write wins. Acceptable for prototype. |
| User resumes draft, makes no further changes, hits Submit | `saveMyApplication` succeeds → draft cleared → redirect to `#/home` → revisit `#/apply` shows "Awaiting review" (existing `viewApplyLive` behavior when an application row exists). |
| User resumes draft, fills more fields, abandons again | New fields join existing fields in the draft. Resume next time shows everything. |
| `localStorage` write fails (quota, disabled storage) | `saveApplyDraft` returns silently; no UI change. Member can still submit normally. |

## Data classification

### New localStorage keys

- `itc.device.id` — UUID, generated once, persisted forever.
- `itc.apply.draft.v1` — JSON draft envelope; cleared on submit or Discard.

Both are device-scoped and contain no PII beyond what the member is actively typing.

### No new Supabase tables / migrations

Per confirmed scope, drafts are localStorage-only. No new schema, no new RLS, no new triggers. The existing live `applications` and `profiles` tables are untouched.

## Files touched (expected)

- `app/js/store.js` — add `getApplyDraft`, `saveApplyDraft`, `clearApplyDraft`; clear draft on `saveMyApplication` success path.
- `app/js/views.js` — add `viewApplyLive`, `applyFormHtml`; change `viewApply` to dispatch on `isLive()`; add resume banner; add visitor CTA swaps on home and account cards.
- `app/js/app.js` — add `data-form === "apply"` submit handler that calls `saveMyApplication`; wire debounced auto-save and `Save draft now` button into the live apply view; wire `[Discard]` actions for the three surfaces.
- `app/js/app.js` — also add a `data-minor-only` block toggle on `age_over_18` change (carried over from `feature/giving-page`).
- `app/smoke.mjs` — add coverage for `getApplyDraft` / `saveApplyDraft` / `clearApplyDraft` and the version-mismatch discard.
- `docs/runbooks/live-auth.md` — note the new draft behavior so the on-call operator knows what the visitor CTA / resume banner mean.

## Out of scope (explicit)

- Cross-device draft sync.
- Draft TTL / expiry.
- Shop integration.
- Service worker.
- Production-ready consent copy.
- A real backend.

## Test plan

Smoke (`node app/smoke.mjs`):

- `getApplyDraft()` returns `null` on a fresh state.
- `saveApplyDraft({ fields: { mobile: "1234" } })` persists; subsequent `getApplyDraft().fields.mobile === "1234"`.
- Second `saveApplyDraft({ fields: { preferred_name: "P" } })` merges, doesn't clobber.
- `clearApplyDraft()` removes the entry; subsequent `getApplyDraft()` returns `null`.
- A draft written with `version: 2` is treated as no draft and is removed on read.

Manual smoke (live deploy preview):

- Sign in with a Google account → land on `/apply` (existing `maybeRedirectToApply` flow) → fill partially → close tab.
- Reopen, navigate to `/apply` → form pre-fills, resume banner visible, indicator shows save time.
- Click `[Discard]` on home → CTA reverts to "Apply to join" and form clears on next `/apply` visit.
- Full submit end-to-end → admin sees "Ready for review" with the new applicant.
