# Island Training Club Web App Product Notes

Last updated: 2026-07-23.

Status: Active brainstorming.

This document is the durable record of product decisions, open questions, and deferred ideas from the Island Training Club app discussion.

## Source Context

- Existing website: https://islandtrainingclub.vercel.app/
- Selected visual direction: Version 1, “Night Circuit.”
- Current visual review artifact: `itc-mobile-design-directions.html`.
- The chosen direction uses the website’s black background, subtle grid, electric-lime accent, white typography, ITC logo, and documentary community photography.

## Product Goal

The product should help Island Training Club engage its community and make activities easier to discover and participate in.

The product should clearly distinguish between activities that are open and free and activities that require booking and payment.

The product may support merchandise purchasing after the core community and activity experience is established.

## Platform Strategy

Phase one will be a responsive web application.

The web application will be designed mobile-first.

The web application should be installable as a Progressive Web App when practical.

The system should be structured so future iOS and Android applications can reuse the same backend, authentication, payments, permissions, and business rules.

The phase-one experience must not depend on interaction patterns that would make a later native-app transition unnecessarily difficult.

## Account And Approval Model

Anyone may create an account.

Every new account requires approval from an ITC leader before receiving full member access.

The account lifecycle is:

1. A person creates an account.
2. The account enters a pending-approval state.
3. An ITC leader reviews the account.
4. The leader approves or declines the account.
5. An approved account receives member access.

Before approval, a person may browse public information about free activities, ITC leaders, and club culture.

Before approval, a person may not book or pay for paid activities.

Before approval, a person may not access member-only information.

### Provisional Signup Recommendation

The following signup design is a recommendation that will be aligned later.

Signup should initially collect:

- Full name.
- Preferred name.
- Email address.
- Mobile or WhatsApp number.
- Date of birth or an age confirmation.
- Emergency contact name and phone number.
- A short explanation of how the applicant heard about ITC.
- Acceptance of the participation waiver.
- Acceptance of the community guidelines.
- Acceptance of the privacy policy.
- Optional and separately controlled photo or media consent.

The signup flow should avoid collecting detailed medical information unless ITC confirms a clear operational and legal need.

The waiver should explain that activities are recreational and may be volunteer-led.

The waiver should acknowledge the inherent risk of physical activity.

The waiver should advise applicants to consult a healthcare professional when appropriate.

The waiver should include the existing supervision requirement for participants aged 17 or younger.

The provisional leader-approval criteria are:

- The applicant supplied complete and plausible contact information.
- The applicant accepted the waiver, privacy policy, and community guidelines.
- The application does not appear duplicated, abusive, fraudulent, or unsafe.
- Any age or guardian requirement has been satisfied.

Approval should not depend on an applicant’s fitness level.

The final signup fields, waiver language, and approval policy require later review.

## Activities

The product must have a clear distinction between free and paid activities.

The distinction must be visible on the home page, activity schedule, activity listings, and activity-detail pages.

### Free Activities

Wednesday Night Training is free.

Wednesday Night Training does not require booking.

The Wednesday Night Training experience must not show capacity, remaining places, booking, or payment language.

Appropriate actions for Wednesday Night Training include:

- View details.
- Add to calendar.
- Get directions.

Free activities should communicate that everyone is welcome when that is accurate.

### Paid Activities

Approved members will book paid activities directly inside the web application.

Approved members will pay for paid activities directly inside the web application.

Weekly ITC HYROX training is confirmed as a paid activity for the phase-one launch.

ITC HYROX is a recurring weekly activity.

Each ITC HYROX session will be purchased separately.

Every weekly ITC HYROX session will use the same fixed price.

The expected paid-activity flow is:

1. View the activity details.
2. Choose a session or required options.
3. Complete payment.
4. Receive a confirmed booking.
5. Receive a receipt.
6. Manage the booking from the member area.

Paid activities will require decisions about capacity, cancellations, refunds, attendance, and payment history.

Additional paid activities for launch have not yet been decided.

## Community Content

The product needs a community area covering ITC leaders and ITC culture.

The leader content should introduce the people responsible for the community.

The culture content should explain the club’s Christian foundation, purpose, values, safety expectations, and community guidelines.

The information architecture may use one Community page with Leaders and Culture sections or separate Leaders and Culture pages.

This structure has not yet been finalized.

## Member Area

The member area should include paid activity bookings and payment history.

Free activities may be saved to a personal schedule without implying that a booking or reserved place exists.

The saved-free-activity behavior is an idea and has not yet been confirmed.

## Administration

ITC leaders need an approval workflow for new accounts.

ITC leaders will need tools to create and manage paid activities.

ITC leaders will likely need tools to manage capacity, attendance, cancellations, refunds, and member communication.

The product will use three roles: Member, Admin, and Super Admin.

Members may use approved-member features but may not access administration tools.

Admins should have most operational rights.

Admins should be able to approve or decline applicants.

Admins should be able to create, edit, publish, and cancel activities.

Admins should be able to manage bookings, attendance, member communication, and routine refunds when refund policy is later defined.

Admins should not be able to change system-critical configuration, manage Super Admins, access payment credentials, delete the entire application, or perform other highly destructive actions.

Super Admins have every permission.

Super Admins may manage Admins and other Super Admins.

Super Admins may change system settings and integrations.

Super Admins may perform sensitive data-management and destructive actions.

The detailed permission matrix will be workshopped later.

## Merchandise

Merchandise purchasing is a potential later capability.

Merchandise is not currently confirmed as part of the phase-one launch scope.

Merchandise will require later decisions about products, inventory, sizes, payments, collection, delivery, and refunds.

## Current Working Recommendation

Phase one should be a bookings-first web application with a lightweight community layer.

Public discovery should include free activities, leaders, and culture.

Approved-member functionality should include paid activity booking and payment.

Merchandise should follow after members already have a strong recurring reason to use the product.

## Open Questions

1. Will any paid activities other than weekly ITC HYROX be available at launch?
2. What is the fixed weekly ITC HYROX price, capacity, day, time, and location?
3. What are the cancellation and refund policies for paid activities?
4. Which member and leader notifications are essential at launch, and through which channels?
5. Should free activities be saveable to a personal schedule?
6. Should Leaders and Culture be one page or separate pages?
7. Which information is member-only?
8. What constitutes a successful phase-one launch?
9. Which payment provider should process HYROX bookings?
10. What is the final signup, waiver, privacy, and approval policy?
11. What is the detailed Admin and Super Admin permission matrix?
12. What legal, privacy, tax, receipt, and data-retention requirements apply?

## Final Discovery Batch For This Session

1. What is the fixed HYROX price per session, maximum number of places, usual weekly day and time, and location?
2. What cancellation and refund rule should apply to paid bookings, including the cutoff before a session?
3. What information and waiver acceptance should signup collect, and what should leaders consider when approving someone?
4. Which leader or administrator roles are needed, and what should each role be allowed to manage?
5. Which notifications are essential at launch for members and leaders, and should they arrive by email, in-app notification, web push, or another channel?

Questions 1 and 2 were intentionally deferred because they require a separate operational workshop.

Question 3 received the provisional recommendation documented under Account And Approval Model.

Question 4 was resolved at the role-model level and requires a later detailed permission workshop.

Question 5 remains unresolved.

## Session Wrap-Up

The conversation established the product direction and a credible phase-one boundary.

Operational policy, payment configuration, legal copy, and detailed administration rules remain deliberately unresolved.

The current material is ready for transfer to a collaborator as a product-discovery handoff.

## Deliberately Not Started

No production application has been built yet.

No implementation architecture has been approved yet.

No payment provider has been selected yet.

No native iOS or Android application work has started.
