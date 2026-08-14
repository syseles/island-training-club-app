# Indemnity Read-and-Accept Modal

**Date:** 2026-08-14
**Branch:** `feature/indemnity-pdf-modal` (off `main`)
**Status:** Approved in brainstorm; implementation requires a reviewed plan

## Problem

The membership application today accepts the indemnity via a one-line checkbox summary in both the local-mode (`viewApplyLocal`) and live-mode (`viewApplyLive`) apply forms, and via an inline text card on Profile > Indemnity (`#/account/indemnity`). The full indemnity text lives only on the Profile page — apply-form users tick a checkbox next to a single summary sentence without ever seeing the document they are agreeing to.

The legal intent of the acceptance is "release & indemnify" (`views.js` ~line 1225). Asking a member to tick that box after seeing only a summary is a UX mismatch, and the existing pattern has no way to verify the member actually read the document.

## Goals

- Surface the full indemnity document to the member at the moment of acceptance, inside the app (no download, no external PDF viewer).
- Require the member to scroll to the end of the document before the acceptance checkbox can be ticked.
- Apply the same read-and-accept pattern consistently to all three surfaces where the indemnity is accepted: apply form (live mode), apply form (local mode), and the Profile > Indemnity page.
- Keep the prototype constraint: no npm deps, no build step, no real PDF asset, no change to localStorage shape or Supabase schema.

## Non-goals

- A real `.pdf` asset or PDF.js / any external PDF library.
- Cross-document generalisation beyond the indemnity (privacy and guidelines stay as plain checkboxes; their copy is still draft placeholders).
- Browser-native PDF viewer integration.
- Signature capture, IP logging, or any audit-trail mechanism for the acceptance.
- Production-ready legal copy (the existing draft wording stays as draft).
- A change to `indemnityAcceptedAt` / `waiver_accepted_at` semantics or persistence.
- Shop, Wednesday Night Training, HYROX, Schedule, Giving, Admin, or Community flows.

## Confirmed scope

### Document source — HTML styled as a paginated PDF (option C)

No real PDF file is created or downloaded. The document body is rendered as HTML styled to look like an A4-ish paginated document:

- Document title at the top: "Health & Liability Indemnity".
- A subtle "Draft — pending ITC leadership review" watermark.
- The four existing sections from `accountIndemnity` in `views.js` ~line 1195: Health declaration, Participation at my own risk, Release & indemnity, Emergency contact.
- Fixed-width column, page-break flow, footer "End of document".
- Total document height comfortably exceeds the modal viewport at default zoom, so scroll-to-end is meaningful.

The copy lives in exactly one place — `app/js/indemnity-doc.js` exports `renderIndemnityDocument()`. Both the modal body and the Profile > Indemnity inline card import from it.

### Modal mechanics

- **Trigger:** `[data-action="open-indemnity-doc"]` elements. Two kinds:
  - Inside a checkbox label on an apply form (paired with `[data-indemnity-checkbox]` and `[data-indemnity-hint]`).
  - On Profile > Indemnity (`View as full document` button) — view-only, no checkbox pairing.
- **Structure:** backdrop overlay → centered modal (~640px wide, ~85vh tall) → header (title + close X) → body (scrollable document container) → sticky footer (acknowledgement button, pinned to the bottom of the modal at all times).
- **Scroll detection:** `scroll` listener on the body container. When `scrollTop + clientHeight >= scrollHeight - 4` (4px tolerance), set `reachedEnd = true`.
- **Footer button:**
  - Initially `disabled` with hint copy "Scroll to the end of the document to continue".
  - Once `reachedEnd`, becomes enabled with the accent colour and label "I have read this document".
  - Click invokes `onAccept()` (which checks + enables the host form's checkbox) and closes the modal.
- **Close paths:** backdrop click, X button, ESC key — all reset `reachedEnd` and reset scroll position to top. Next open starts fresh.
- **Accessibility:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the title, focus moved into the modal on open, focus returned to the trigger on close, Tab trapped inside the modal while open.

### Apply form — live mode (`viewApplyLive`)

The `waiver` checkbox block becomes:

```html
<label class="check">
  <input type="checkbox" name="waiver" required disabled data-indemnity-checkbox>
  <span>I accept the <a href="#" class="modal-link" data-action="open-indemnity-doc">Health &amp; Liability Indemnity</a> form. *</span>
</label>
<p class="muted small" data-indemnity-hint>Read the document to enable acceptance.</p>
```

- Checkbox starts `disabled`; hint visible.
- On `onAccept` from the modal: `disabled` removed, `.checked = true`, hint hidden.
- Form submission continues to use today's `acceptIndemnity()` / `waiver_accepted_at` flow unchanged.

### Apply form — local mode (`viewApplyLocal`)

Identical pattern, with the checkbox `name="indemnity"` instead of `waiver`. Same label, same modal trigger, same `onAccept` semantics. The submission handler already reads `form.indemnity` in `app/js/app.js` ~line 853; no change there.

### Profile > Indemnity page (`accountIndemnity`)

- Above the existing inline text card, insert:
  ```html
  <button class="btn ghost sm" type="button" data-action="open-indemnity-doc">View as full document</button>
  ```
- The inline text card renders visually unchanged (same `.card .prose` chrome, same four sections, same "Draft wording" footer note). Internally its body markup is replaced by a call to `renderIndemnityDocument()` so the copy lives in one place. Members can still read in-line or open the modal — both render the same document body.
- The existing acceptance form (checkbox + Accept & Confirm) stays exactly as today.
- The button has no `data-indemnity-checkbox` paired with it; `onAccept` is a no-op aside from closing the modal.

### Acknowledgement callback

Delegated click handler in `app/js/app.js`:

1. Calls `openIndemnityModal({ onAccept })`.
2. `onAccept` locates the nearest `[data-indemnity-checkbox]` in the same form (or `null` if triggered from the Profile > Indemnity button).
3. If found: removes `disabled`, sets `.checked = true`, hides `[data-indemnity-hint]`.
4. Modal closes in all cases.

## Data classification

### New module-local state (not persisted)

- `reachedEnd` (boolean) — in-memory only, per modal session.
- Scroll position — in-memory only, reset on close.

### No new persisted fields

- `state.users[].indemnityAcceptedAt` unchanged.
- Supabase `waiver_accepted_at` column unchanged.
- `STATE_VERSION` unchanged; no migrations added.

## Files touched (expected)

- `app/js/indemnity-doc.js` — new. Exports `renderIndemnityDocument()` returning the styled HTML body. Single source of truth for the document copy.
- `app/js/components.js` — new. Exports `openIndemnityModal({ onAccept })`. Owns backdrop, focus trap, ESC-to-close, scroll detection, sticky footer button, acknowledgement callback. Reusable for any future read-and-accept document.
- `app/styles.css` — adds `.modal-shell`, `.modal-backdrop`, `.modal-doc`, `.modal-doc-body`, `.modal-doc-ack`, `.modal-link`, and the disabled-with-hint styling for the paired checkbox.
- `app/js/views.js` — four surgical edits: rewrite the `waiver` checkbox block in `viewApplyLive`; rewrite the `indemnity` checkbox block in `viewApplyLocal`; insert the `View as full document` button in `accountIndemnity`; replace the inline text card body in `accountIndemnity` with an `indemnityDoc.renderIndemnityDocument()` call (visual unchanged, markup DRY).
- `app/js/app.js` — one new delegated click handler for `[data-action="open-indemnity-doc"]` that calls `openIndemnityModal({ onAccept })`. Imports the new modules.
- `app/smoke.mjs` — assertions updated for the new checkbox labels and the new Profile > Indemnity button; new unit-style assertions for the scroll-end threshold math and the `onAccept` callback enabling + checking a paired `data-indemnity-checkbox`.

## Out of scope (explicit)

- Real `.pdf` asset.
- PDF.js or any external PDF library.
- New localStorage fields or migrations.
- New Supabase tables, columns, or RLS changes.
- Cross-document generalisation to privacy / community-guidelines checkboxes.
- Signature capture or audit logging.
- The existing Profile > Indemnity acceptance form (stays unchanged).
- Any flow outside the three named surfaces.

## Test plan

Smoke (`node app/smoke.mjs`):

- The apply form (live mode) checkbox label renders with the underlined `Health & Liability Indemnity` link inside it.
- The apply form (live mode) checkbox starts with `disabled` and `[data-indemnity-hint]` visible.
- `openIndemnityModal` renders the document body and the sticky footer button.
- The scroll-end threshold math returns `true` at `scrollHeight - 4`, `false` at `scrollHeight - 100`.
- Simulated `onAccept` (called directly, bypassing the modal UI) enables and checks a paired `data-indemnity-checkbox` and hides the hint.
- The Profile > Indemnity page renders both the inline text card and the new `View as full document` button.
- Submitting the apply form (live mode) still records `waiver_accepted_at` / `indemnityAcceptedAt` as today (no regression).

Manual smoke (local dev server):

- `python3 -m http.server 4173`, open `http://127.0.0.1:4173/app/`.
- Live mode apply form: confirm checkbox is disabled, hint visible. Click the link → modal opens → scroll body → footer button enables at the bottom → click "I have read this document" → modal closes → checkbox is enabled and ticked, hint hidden → submit still works.
- Local mode apply form: same flow, `name="indemnity"` checkbox.
- Profile > Indemnity page: button is present, opens the modal, scrolls, closes silently. Inline text card and Accept & Confirm flow still work.
- ESC, backdrop click, X button: all close the modal and reset scroll position.

## Open questions for the implementation plan

None blocking. The implementation plan should call out:
- Whether the new modules are imported via dynamic `import()` or added as additional ES module imports in `app.js` (depends on the existing import graph).
- The exact CSS variable usage (existing `--accent`, `--surface-3`, `--line`, `--radius-sm`, etc.) to keep the visual consistent with the Night Circuit palette.
- How the scroll-end threshold value is exposed for testing (export the threshold constant from `components.js` so the smoke test can assert against it directly).
