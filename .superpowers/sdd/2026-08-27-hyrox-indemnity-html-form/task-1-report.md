# Task 1 Report — Replace the Draft Document with Versioned Hyrox Legal Copy

## Implementation summary
- Replaced the indemnity document source with the approved Hyrox legal copy.
- Added `INDEMNITY_VERSION = "v1"` and updated `DOCUMENTS.indemnity.title` to `Indemnity`.
- Added semantic clause-list styling for numbered clauses and lettered subclauses.
- Removed the draft watermark styling from the modal body.
- Updated smoke assertions to validate the new versioned legal-copy contract and the ten clause markers.

## Files changed
- `app/js/documents.js`
- `app/styles.css`
- `app/smoke.mjs`

## TDD RED / GREEN
### RED
Command:
```sh
node app/smoke.mjs
```
Relevant output:
```text
FAIL Profile > Indemnity card missing clause markers 1 or 10
FAIL indemnity version should be v1, got undefined
FAIL indemnity title should be Indemnity, got Health & Liability Indemnity
FAIL indemnity document missing opening marker "ITC Hyrox Training - Liability Release &amp; Data Privacy Form"
FAIL indemnity document missing clause 1: "to assume and accept all and any risks"
...
18 FAILURE(S)
```

### GREEN
Command:
```sh
node app/smoke.mjs
```
Relevant output:
```text
ok  Profile > Indemnity card exposes clause markers
ok  indemnity registry exposes versioned Hyrox legal copy
All smoke tests passed.
```

## Self-review
- Confirmed the document body uses the exact approved structure and clause text.
- Confirmed the clause-list CSS uses semantic `<ol>` numbering for top-level clauses and CSS counters for nested subclauses.
- Confirmed the modal draft watermark was removed.
- Confirmed no changes were made to store, views, app handlers, or Supabase.

## Concerns
- The indemnity profile page heading remains outside this task’s scope, so visual consistency there should be revisited only if a later task requires it.
- The nested clause spacing/indentation should be spot-checked in-browser, but smoke coverage is green.

## Review round 1 fixes
- Restored the Profile inline-card smoke assertion for the Hyrox source-title marker alongside the clause markers.
- Restored the document-registry body-content assertions for privacy and guidelines.
- Restored the shared `.modal-doc-body::after` watermark rule so privacy/guidelines modal presentation stays unchanged.

## Verification
Command:
```sh
node app/smoke.mjs
```
Relevant output:
```text
ok  Profile > Indemnity card includes Hyrox source title marker
ok  Profile > Indemnity card exposes source title and clause markers
ok  documents registry exposes indemnity + privacy + guidelines
ok  privacy and guidelines registry bodies still expose their section headings
ok  styles.css contains all modal-related class definitions
All smoke tests passed.
```
