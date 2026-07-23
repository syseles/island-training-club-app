# Island Training Club Web App Handoff

Date: 2026-07-23.

## Current State

The project is in product discovery.

Version 1, “Night Circuit,” has been selected as the visual direction.

A browser-based design comparison exists with three directions and five conceptual screens per direction.

No production application code exists yet.

## Source Of Truth

Read these files in order:

1. `docs/phase-one-product-brief.md`
2. `docs/itc-web-app-product-notes.md`
3. `itc-mobile-design-directions.html`

The phase-one brief is the concise current product direction.

The product notebook contains the discussion history, recommendations, and unresolved questions.

The HTML artifact is visual exploration, not approved product behavior.

## Important Correction To The Mockups

The current Version 1 mockup incorrectly presents Wednesday Night Training as bookable.

Wednesday Night Training is free and does not require booking.

Any next design pass must replace booking and capacity language with open-attendance actions such as View Details, Add to Calendar, and Get Directions.

## Confirmed Product Decisions

- Phase one is a responsive, mobile-first web application.
- The system should be reusable by later iOS and Android clients.
- Anyone may apply for an account.
- An ITC leader must approve every applicant before full member access.
- Public visitors and pending applicants may browse free activities, leaders, and culture.
- Paid activity booking and member-only information require approval.
- Weekly HYROX is included at launch.
- HYROX is paid separately for each weekly session.
- Every HYROX session uses the same fixed price.
- Booking and payment happen inside the application.
- The role model is Member, Admin, and Super Admin.
- Super Admin has every right.
- Admin has normal operational rights but not system-critical or highly destructive rights.

## Recommended But Not Final

The signup fields, waiver design, approval criteria, and Admin permission boundary are recommendations.

They require review with ITC leadership before implementation.

## Unresolved Work

See the Deferred Or Unresolved section in `docs/phase-one-product-brief.md`.

The most immediate workshops should cover:

1. HYROX price, capacity, schedule, and venue.
2. Cancellation, refund, and no-show policy.
3. Payment provider and accounting requirements.
4. Signup, waiver, privacy, and approval policy.
5. Admin and Super Admin permission matrix.
6. Notification requirements.

## Collaboration

Direct pushes are acceptable.

No branch protection is requested.

The repository should remain private unless the owner explicitly changes that decision.

A collaborator can be granted direct write access after their GitHub username is provided.

## Suggested Next Work Session

Begin with a short operational-policy workshop.

Then revise the selected Version 1 screens to reflect the confirmed activity and approval models.

Do not begin production implementation until the revised product design and unresolved launch policies are approved.
