# Task 2 report — Replace Date of Birth With Required Age Status

## Done
- Replaced DOB inputs with required `age_over_18` yes/no radios in live and local application forms.
- Added minor-only guardian fields to the local form and kept guardian toggling for both live and local apply flows.
- Replaced DOB-based toggle logic in `app/js/app.js` with radio-based age-status handling.
- Updated `saveMyApplication()` to persist `date_of_birth: null`, `is_minor`, and guardian fields from age status.
- Updated local `applyForMembership()` to validate `ageOver18`, require guardian details for minors, and store `isMinor`.
- Updated pending-application display to read from `isMinor`.
- Added smoke coverage for live/local age-status HTML and local yes/no persistence.

## Verification
- Ran `node app/smoke.mjs`
- Result: pass (`All smoke tests passed.`)

## Scope preserved
- Only task files were changed.
- Existing unrelated untracked files were left untouched.
