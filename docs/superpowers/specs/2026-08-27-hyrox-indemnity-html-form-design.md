# Hyrox Indemnity HTML Form

**Date:** 2026-08-27  
**Branch:** `feature/read-and-accept-docs`  
**Status:** Approved in brainstorm; implementation requires a reviewed plan

## Problem

The application currently presents draft indemnity wording through the reusable read-and-accept document modal and Profile > Indemnity. The final source is now the Google Form:

<https://docs.google.com/forms/d/e/1FAIpQLSfCPoTqtzJyjKZnKnk-eA3_NNeXT6rvj7wdxNZZcCbvmSvLuA/viewform?pli=1>

The source form is titled **“ITC Hyrox Training - Liability Release & Data Privacy Form.”** It contains a Hyrox-specific liability release, typed-name signature, signing date, and emergency contact fields. The app must replace today's placeholder without losing the existing scroll-to-bottom acknowledgement gate.

The app already captures emergency contact name and phone, but not relationship. It also records only an acceptance timestamp, not the typed signature, signing date, or document version.

## Goals

- Replace the existing draft indemnity body with the Google Form’s Hyrox-specific wording.
- Keep the current Profile sub-page route and heading: `#/account/indemnity` and **Indemnity**.
- Keep HTML as the document format, styled through the existing PDF-like modal; do not create a `.pdf` asset.
- Preserve the existing requirement to scroll to the bottom before acknowledgement is enabled.
- Capture the Google Form’s participant signature and signing date.
- Add emergency contact relationship to the existing canonical emergency contact record.
- Store the exact indemnity document version accepted by the member.
- Require a new signature when the document version changes, but do not implement calendar expiry.
- Keep acceptance at membership application time; do not add a HYROX detail or checkout gate.
- Preserve localStorage compatibility through an explicit state migration.
- Persist the same data in Supabase live mode through additive schema columns.

## Non-goals

- Creating or embedding a real PDF file.
- Adding PDF.js, a PDF-generation library, an npm dependency, or a build step.
- Adding a drawn-signature canvas.
- Enforcing expiry on 31 December 2026 or any recurring annual deadline.
- Adding an indemnity prompt to HYROX activity detail, booking, or checkout.
- Rewriting or legally editing the Google Form wording.
- Changing privacy-policy or community-guidelines content.
- Changing Shop, Giving, Community, Schedule, payments, or administrative behaviour.

## Confirmed Product Decisions

1. The new Hyrox-specific indemnity replaces the current general placeholder.
2. The scroll-to-bottom acknowledgement gate remains.
3. The acceptance captures typed signature, signing date, emergency contact name, relationship, and phone.
4. The apply form remains the normal acceptance point for all applicants.
5. Profile > Indemnity handles legacy members and re-signing after a document-version change.
6. HYROX viewing and booking do not present a second gate.
7. Signature is free-form text and need not match the profile name.
8. Signing date defaults to today, remains editable, allows backdating, and may not be in the future.
9. There is no automatic calendar expiry. A changed document version requires a new signature.
10. Membership Details remains the canonical source for emergency contact name, relationship, and phone.
11. The Profile sub-page heading stays **Indemnity**.
12. The existing HTML/PDF-style modal is the only document artefact.

## Architecture

### Document registry

`app/js/documents.js` remains the single source of truth for every read-and-accept body.

- Keep the existing `indemnity` registry key so current `data-action="open-doc" data-doc="indemnity"` triggers remain valid.
- Replace `renderIndemnityDocument()` with the new Hyrox-specific introductory paragraphs and ten clauses.
- Keep `privacy` and `guidelines` unchanged.
- Export a literal `INDEMNITY_VERSION`, initially `"v1"`.
- Bump `INDEMNITY_VERSION` whenever the indemnity body changes in a way that requires renewed consent.

The modal title and Profile heading remain **Indemnity**. The document body itself retains its source title and Hyrox-specific wording.

### Existing modal

The reusable document modal remains structurally unchanged:

- Triggered by `[data-action="open-doc"][data-doc="indemnity"]`.
- Scrollable body with the existing four-pixel end tolerance.
- Acknowledgement initially disabled with “Scroll to the end of the document to continue.”
- Enabled at the bottom with “I have read this document.”
- Acknowledgement enables and checks the paired host-form checkbox.
- Backdrop, close button, and Escape close the modal and reset its scroll state.
- Existing focus movement, focus restoration, and focus trap remain.

Signature and contact inputs stay in the host form rather than expanding the document modal into a full data-entry component.

### Views

`app/js/views.js` continues to render the same Profile route and apply-form surfaces.

- `accountIndemnity(user)` renders the new document inline through `renderIndemnityDocument()`.
- Remove the “Draft wording” footer because the supplied form is now the source.
- Keep “View as full document.”
- Keep the apply-form indemnity checkbox and modal link in local and live mode.
- Replace pending-review placeholder copy with “I accept the Indemnity form. *”.
- Add signature and signing-date inputs to local and live application forms.
- Add emergency contact relationship to the existing emergency contact block.

## User Flows

### Membership application

The application form shows, in order:

1. Emergency contact name.
2. Emergency contact relationship.
3. Emergency contact phone.
4. Required Indemnity checkbox with modal link.
5. Required typed-signature input.
6. Required signing-date input, defaulted to today.
7. Existing privacy and guidelines controls.

The Indemnity checkbox starts disabled. The member opens the document, scrolls to the bottom, and selects **I have read this document**. The callback closes the modal, enables the checkbox, and checks it. The member then types their signature and submits the application.

Successful submission records the acceptance timestamp, typed signature, signing date, current document version, and emergency contact relationship together.

### Profile > Indemnity: current acceptance

A member whose stored form version matches `INDEMNITY_VERSION` sees:

- “Indemnity confirmed on [date].”
- Typed signature.
- Date of signing.
- Emergency contact name, relationship, and phone.
- Accepted document version.
- Full document inline.
- “View as full document.”

No repeat acceptance form is shown.

### Profile > Indemnity: legacy, missing, or stale acceptance

A member with no accepted current version sees:

- “To be accepted,” or “A new version of the Indemnity is available. Please read and re-sign.”
- Full document inline.
- “View as full document.”
- Disabled acknowledgement checkbox paired with the modal.
- Blank typed-signature field.
- Signing date defaulted to today.
- Emergency contact name and phone as read-only values.
- Editable relationship field prefilled from Membership Details when available.
- “Edit in Membership Details →”.
- “Accept & Confirm.”

Submitting saves all consent fields atomically. A failed write does not display the consent as confirmed. Re-signing is required to return the Profile status to confirmed, but stale consent does not gate HYROX or unrelated app flows.

### Membership Details

Profile > Membership Details remains the canonical emergency contact editor. Its contact block contains name, relationship, and phone in that order.

Changing emergency contact details later updates the values shown on Profile > Indemnity. It does not invalidate the accepted document version or require re-signing. Only a change to `INDEMNITY_VERSION` requires renewed consent.

## Data Model

### Local state

Add these fields to `state.users[]`:

```js
{
  indemnitySignature: "Jane Chan",
  indemnitySignedAt: "2026-08-27",
  indemnityFormVersion: "v1",
  emergencyRelationship: "Spouse"
}
```

Keep existing fields unchanged:

```js
{
  indemnityAcceptedAt: 1787788800000,
  emergencyName: "Alex Chan",
  emergencyPhone: "+852 9000 0000"
}
```

Field semantics:

- `indemnityAcceptedAt`: machine timestamp when Accept & Confirm or the application submission succeeded.
- `indemnitySignature`: the trimmed free-form typed signature.
- `indemnitySignedAt`: member-selected ISO calendar date (`YYYY-MM-DD`).
- `indemnityFormVersion`: exact `INDEMNITY_VERSION` accepted.
- `emergencyRelationship`: canonical relationship text shared by application, Membership Details, and Indemnity.

### State migration

Bump `STATE_VERSION` from 13 to 14.

The v14 migration:

- Preserves every existing key and genuine domain record.
- Adds the four new fields to users when absent, using `null` rather than inventing data; unlike `undefined`, `null` survives JSON persistence.
- Preserves existing `indemnityAcceptedAt` timestamps.
- Treats timestamp-only legacy acceptance as not current because it lacks `indemnityFormVersion`, signature, and signing date.
- Does not delete users, bookings, payments, queues, receipts, or applications.

A helper such as `isIndemnityCurrent(user)` returns true only when the accepted version matches `INDEMNITY_VERSION` and the required signature and signing-date fields are present.

### Store actions

Local acceptance actions change from timestamp-only calls to structured payloads:

```js
acceptIndemnity(userId, {
  signature,
  signedAt,
  emergencyRelationship,
  formVersion: INDEMNITY_VERSION,
})
```

The action validates and saves all acceptance fields together, updates the canonical relationship value, stamps `indemnityAcceptedAt`, and continues returning `indemnityAcceptedAt` so existing call sites retain their timestamp contract.

`store.apply()` and draft actions capture the same fields during application. `store.updateMembershipDetails()` persists relationship with contact name and phone.

### Supabase live mode

Add nullable columns to the `applications` table through a new migration:

```sql
waiver_signature_text   text,
waiver_signed_at        date,
waiver_form_version     text,
emergency_relationship  text
```

Keep existing columns, including `waiver_accepted_at`, `emergency_name`, and `emergency_phone`.

Live application insert, application hydration, Membership Details update, and Profile > Indemnity re-sign update map the four new columns to the local user shape. Existing rows with null new fields remain readable and render as requiring completion/re-signing.

## Validation and Error Handling

- Indemnity checkbox must have been enabled through the modal acknowledgement flow.
- Signature is required and must contain at least two non-whitespace characters.
- Signing date is required, must be a valid ISO date, and cannot be later than today.
- Emergency contact name, relationship, and phone are required at application time.
- Profile re-signing requires canonical name and phone plus a relationship value.
- Validation messages use existing inline error containers and preserve entered values.
- Supabase errors remain visible and do not optimistically mark acceptance complete.
- External IECC privacy-policy link opens safely and retains its exact source URL.

## Testing

Update `app/smoke.mjs` with the behaviour change in the same commit.

### Document assertions

- Registry still exposes `indemnity`, `privacy`, and `guidelines`.
- Indemnity contains the Hyrox-specific opening text, all ten clauses, and the IECC privacy-policy URL.
- Draft-placeholder wording is absent.
- Existing scroll-end, disabled acknowledgement, callback, reset, and accessibility assertions remain.

### Application assertions

- Local and live forms render emergency relationship, Indemnity modal trigger, disabled acceptance checkbox, signature input, and signing-date input.
- Missing acknowledgement, signature, date, or relationship prevents submission.
- Successful application stores all new fields and current document version.
- Application draft save/resume retains new values.

### Profile and persistence assertions

- Current acceptance displays confirmation, signature, signing date, and relationship.
- Missing or stale version displays the re-sign state and Accept & Confirm.
- Structured `acceptIndemnity()` persists fields together.
- Membership Details displays and saves relationship.
- v13 snapshots migrate to v14 without record loss.
- Timestamp-only legacy acceptance does not masquerade as acceptance of the current version.
- Live mappings include all four additive Supabase columns.
- Existing HYROX detail and booking views add no second indemnity prompt.

### Verification

Automated:

```sh
node app/smoke.mjs
```

Manual browser check at mobile and desktop widths:

1. Open the application and verify the checkbox cannot be selected directly.
2. Open Indemnity, close before the bottom, reopen, and verify scroll reset.
3. Scroll to the bottom and acknowledge.
4. Enter signature, date, and emergency relationship; submit.
5. Confirm Profile > Indemnity displays the stored details.
6. Edit relationship through Membership Details and confirm it updates the Indemnity display.
7. Confirm no second prompt appears during HYROX viewing or booking.

## Approved Source Copy

Implementation must preserve the Google Form wording verbatim except for semantic HTML structure and HTML escaping. No legal rewrite is authorised.

> I am aware that my participation in the Island Training Club (“ITC”) Hyrox Training from the date of signing to 31 December 2026, including but not limited to: HYROX-style training, running, rowing, SkiErg, sled push/pull, wall balls, lunges, burpees, bodyweight movements, weights, warm-ups, cool-downs, partner drills and/or other functional fitness exercises (the “Activity”) involve inherent risks, including fatigue, overexertion, muscle soreness, sprains, strains, falls, collision with persons or objects, aggravation of pre-existing conditions, illness, injury and, in rare cases, serious injury or death.
>
> Having regard to the religious and non-profit nature of ITC and Island Evangelical Community Church Limited (“IECC”) (including but not limited to their officers, directors, employees, agents, representatives and volunteers) (collectively, the “Organizer”) of the Activity, and in consideration of IECC and/or ITC accepting my participation in the Activity, I hereby agree and confirm as follows:
>
> 1. to assume and accept all and any risks of personal injury, sickness, death, damage, dangers and expenses arising out of, incidental to or in any way connected with my participation to the Activity;
>
> 2. to waive any and all claims, actions, costs, expenses and demands that I may have against the Organizer within and outside Hong Kong;
>
> 3. to release:
>
> (a) the Organizer from any and all liability for any loss, damage, injury or expense that I or my next of kin may suffer or incur as a result of my participation in the Activity, due to any cause whatsoever including but not limited to negligence on the part of the Organizer; and
>
> (b) IECC from any and all liability for any loss, damage or expense that arises in relation to the storage, maintenance and/or usage of any equipment in respect of the Activity or any other Hyrox-related training taking place within the premise of IECC;
>
> 4. to hold harmless and indemnify:
>
> (a) the Organizer for any liability sustained by the Organizer as the result of my negligent, willful or intentional acts; and
>
> (b) IECC for any loss or damage caused to any part of the premise, fixture or equipment of IECC resulting from my participation in the Activity;
>
> 5. that appropriate insurance shall be taken out by me on an individual level (if necessary), and the Organizer shall not be responsible for taking out personal liability insurance for the Activity or for individuals participating in the Activity. It is my sole discretion and responsibility to subscribe my own personal insurance liability relating to the Activity if I deem necessary;
>
> 6. the leaders of ITC and/or IECC have the right to request an individual to cease participation in the Activity if, at the sole opinion of the leaders of ITC and/or IECC, the actions of that individual may endanger the safety of himself/herself and/or other participants of the Activity;
>
> 7. that my level of physical fitness is adequate for the Activity and, if not, that I will be responsible for ensuring that I consult with a physician about my physical condition before and after participating in the Activity;
>
> 8. that this Form shall be effective and binding upon my next of kin, executors, administrators and assigns, in the event of my death;
>
> 9. that I agree to the personal data privacy statement of IECC (available at <https://www.islandecc.hk/privacy-policy/>) and I agree that the personal data provided by me for the Activity will be used for the purposes of managing and organizing the Activity and handling my enquiries in relation to the Activity and/or the Organizer; and
>
> 10. that the laws of Hong Kong shall govern this Form and any disputes arising hereof shall be determined by the courts of Hong Kong.

## Alternatives Rejected

- **Separate HYROX consent gated at checkout:** rejected; application remains the acceptance point and booking should not prompt again.
- **Profile-only acceptance:** rejected; new applicants must accept during application.
- **Annual or 31 December expiry:** rejected; only a form-version change requires re-signing.
- **Timestamp-only acceptance:** rejected; the source form requires typed signature, signing date, and emergency contact relationship.
- **Duplicate emergency contact data inside the consent record:** rejected; Membership Details remains canonical.
- **Real PDF asset or generated PDF:** rejected; existing HTML/PDF-style modal is sufficient.
