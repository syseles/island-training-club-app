# Same-Device FPS Transfer Design

**Date:** 2026-08-30
**Status:** Approved

## Goal

Replace every mock FPS QR presentation with accurate same-device transfer guidance. Members should be able to copy the FPS destination and payment reference, switch to their banking app, make the transfer, and return to the existing reconciliation flow.

## Scope

This design covers the paid-booking FPS instructions and the member Giving FPS instructions. It removes QR placeholders, QR claims, and CSS used only by those placeholders. It adds delegated clipboard controls with accessible names and visible success or error feedback.

It does not add real payment processing, bank deep links, payment-provider detection, automatic reconciliation, backend fields, or changes to authentication, authorization, collector assignment, donation recording, receipts, or Payment Ops.

## Paid Booking Experience

The existing PayMe option remains available. The FPS section shows:

- the assigned collector as the payee;
- the collector's FPS mobile number;
- the exact booking amount;
- a deterministic suggested reference derived from the booking ID;
- **Copy FPS number** and **Copy reference** buttons.

The suggested reference is also prefilled in the existing reconciliation reference input. A member may edit it before selecting **I’ve paid**. The payment method selection and existing mark-paid behavior remain unchanged.

Instructions are concise and ordered:

1. Open your banking app.
2. Choose FPS and pay by mobile number.
3. Paste the FPS number.
4. Enter the exact amount and suggested reference.
5. Return to ITC and use the existing **I’ve paid** action.

No text claims that all banking apps support a deep link, an embedded amount, or QR scanning.

## Giving Experience

After a member chooses an amount, the existing FPS step shows:

- campaign FPS ID and payee;
- exact gift amount;
- the existing generated Giving reference;
- **Copy FPS ID** and **Copy reference** buttons.

The same-device instructions tell the member to open their banking app, choose FPS, pay using the FPS ID, paste the copied value, and enter the displayed amount and reference. The existing **I’ve made the transfer** action records the mock donation for later leader reconciliation.

The locked-member state, campaign state, generated reference, gift history, and thank-you state remain unchanged.

## Clipboard Behavior and Accessibility

Clipboard controls remain inside the existing document-level click delegation. Each rendered button has an explicit `aria-label`, a non-empty inert data value, and a specific action name. The handler:

- reads only the control's text data;
- rejects empty values;
- feature-detects `navigator.clipboard.writeText`;
- awaits and catches clipboard failures;
- announces success through the existing status toast;
- announces unsupported or failed copying through the existing error toast.

No copied value is inserted as HTML or evaluated as code.

## Visual and Code Changes

The current dashed `.fps-qr` placeholders are removed from both views. Because no other view uses that class, its CSS is removed. Existing cards, receipt lines, button rows, ordered-list typography, and design tokens are reused; no dependency or new component system is introduced.

The implementation is limited to:

- `app/js/views.js` for payment references, FPS details, instructions, and controls;
- `app/js/app.js` for safe delegated copy behavior;
- `app/styles.css` for removal of the now-unused QR placeholder rule;
- `app/smoke.mjs` and `app/live-auth-smoke.mjs` for regressions;
- this spec and its implementation plan.

No localStorage or Supabase shape changes are required.

## Error Handling

A missing collector FPS number remains visible as unavailable data rather than producing a copyable blank value. Copy buttons are rendered only for non-empty values. Clipboard API absence or rejection does not alter payment state and produces an error toast. Members can still select and copy visible text manually.

Mark-paid and donation-recording errors continue through their existing handlers. Clipboard success never implies that money moved or that reconciliation succeeded.

## Testing

Follow red-green TDD:

1. Add rendering assertions proving paid booking shows collector/payee, FPS phone, exact amount, suggested reference, accessible copy controls, and same-device steps without QR/scan/embedded-amount claims.
2. Add Giving step-two assertions proving FPS ID/payee, amount/reference, accessible copy controls, and same-device steps without QR or bank-link claims.
3. Add delegated-handler assertions for FPS destination and reference success, unsupported clipboard, rejected writes, and error feedback.
4. Implement the minimum view, handler, and CSS changes.
5. Run `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, syntax checks for JavaScript modules/scripts, and `git diff --check`.

## Acceptance Criteria

- No member-facing FPS flow contains QR UI or QR/scan/embedded-amount claims.
- Paid booking displays the assigned collector/payee, FPS phone, exact amount, and suggested reference.
- Giving displays FPS ID/payee, exact amount, and generated reference.
- Both flows provide destination and reference copy actions with accessible names.
- Clipboard success and failure are announced accurately.
- No universal banking-app deep link is introduced or claimed.
- Existing mock-payment boundary, authorization, payment reconciliation, donation recording, and receipts remain intact.
- No unrelated Admin Ops changes enter the implementation diff.
