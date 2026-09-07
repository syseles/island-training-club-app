# Task 4 Report — Add Signature, Date, and Relationship to Both Application Forms

## Summary
Implemented the approved Task 4 form changes for both local and live application flows:
- Added required relationship, signature, and signing-date inputs to both application forms.
- Updated indemnity link text to `Indemnity` while preserving the existing privacy/guidelines modal blocks.
- Added max-today date limits for signing dates.
- Preserved the existing read-and-accept modal / scroll-to-bottom gating behavior.
- Wired the new local and live submit payload fields through existing store APIs.
- Kept Profile full re-sign refinement for Task 5.
- Did not add any HYROX detail/checkout gate.

## Files Changed
- `app/js/views.js`
- `app/js/app.js`
- `app/smoke.mjs`
- `app/live-auth-smoke.mjs`

## TDD Record
### Red
Updated tests first to require:
- local apply form names: `emergencyRelationship`, `indemnitySignature`, `indemnitySignedAt`
- local signature label and `max="today"` date cap
- live apply form names: `emergency_relationship`, `waiver_signature_text`, `waiver_signed_at`
- live indemnity modal container / disabled gated checkbox
- live draft persistence for relationship, signature, and date
- live submit handler boolean coercion for `payload.waiver`
- local submit handler payload fields for `indemnitySignature` and `indemnitySignedAt`

Observed expected failures:
- `node app/smoke.mjs` failed on missing local signature/date fields and old local payload mapping.
- `node app/live-auth-smoke.mjs` failed on missing `payload.waiver = !!fd.get("waiver")`.

### Green
Implemented the minimal form and submit-handler changes, then re-ran both suites successfully.

## Implementation Notes
### `app/js/views.js`
- Extended `applyField()` with optional static attribute support for safe caller-provided attrs.
- Live apply form:
  - changed emergency relationship label to `Relationship to participant`
  - kept indemnity modal block and changed link text to `Indemnity`
  - added `waiver_signature_text`
  - added `waiver_signed_at` with default `todayISO()` and `max="todayISO()"`
- Local apply form:
  - changed emergency row to name / relationship / phone
  - kept indemnity modal block and changed link text to `Indemnity`
  - added `indemnitySignature`
  - added `indemnitySignedAt` with default `todayISO()` and `max="todayISO()"`
  - removed the outdated draft/legal placeholder paragraph

### `app/js/app.js`
- Added `showInlineFormError()` to render local apply errors safely without `innerHTML` interpolation.
- Live `data-form="apply"` handler now coerces `payload.waiver` to boolean before `store.saveMyApplication(payload)`.
- Local `form-apply` handler now builds a named payload using:
  - `emergencyRelationship`
  - `indemnitySignature`
  - `indemnitySignedAt`
- Local apply flow now uses safe inline errors for donor ID validation, duplicate applications, and thrown store errors.

### Draft Persistence
No store changes were needed. `collectApplyDraftFields()` already serializes every named control, so the new live fields resume automatically once rendered with the new names.

## Verification
### Required test commands
- `node app/smoke.mjs`
- `node app/live-auth-smoke.mjs`

### Final result
Both commands passed after implementation.

## Constraints / Non-Changes Kept Intact
- Privacy and guidelines modal acceptance blocks preserved.
- Existing document modal acceptance and scroll gate preserved.
- Profile indemnity re-sign flow left for Task 5.
- No HYROX detail/checkout gate added.
