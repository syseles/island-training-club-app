# Final fix report

## Status

Ready. Both final-review findings are resolved.

## Changes

- Changed the Admin member Status default chip label from `All statuses` to exactly `All` and updated both smoke suites.
- Normalized ordinary Archivo typography to the approved hierarchy:
  - body copy: 400
  - raw form controls: 600
  - labels, buttons, tabs, badges, kickers, and other controls: 700
  - primary headings, greetings, and profile headings: 800
- Removed all ordinary UI uses of weight 900. The `100 900` declaration remains only as the Archivo variable font-face range.
- Preserved the technical monospace token and `.mono` utility unchanged.
- Added smoke-test contracts for the weight hierarchy, absence of ordinary weight 900, and preserved technical monospace styling.

## Verification

- `node app/smoke.mjs` — passed
- `node app/live-auth-smoke.mjs` — passed
- `node --check` for every `app/**/*.js` and `app/**/*.mjs` file — passed
- `git diff --check` — passed
- Ordinary 900-weight scan — passed (none found)
