# Island Training Club Web App Phase-One Product Brief

Date: 2026-07-23.

Status: Working product brief for collaborator transfer.

## Product Vision

Island Training Club needs a community web application that makes its activities, people, and culture easy to discover.

The application should remove operational friction from paid training while preserving the open and welcoming character of free community activities.

## Phase-One Platform

Phase one is a responsive, mobile-first web application.

The application should be installable as a Progressive Web App when practical.

The backend, authentication, permissions, payments, and activity rules should be exposed through stable interfaces that future iOS and Android clients can reuse.

Native applications are not part of phase one.

## Audiences

### Public Visitor

A public visitor may view free activities, ITC leaders, and ITC culture.

A public visitor may create an account.

A public visitor may not book or pay for paid activities.

A public visitor may not access member-only information.

### Pending Applicant

A pending applicant has submitted an account application.

A pending applicant keeps public access while waiting for an ITC leader’s decision.

A pending applicant may not use approved-member functionality.

### Member

A Member has been approved by an ITC leader.

A Member may access member information and book and pay for paid activities.

A Member may manage their bookings, receipts, and profile.

### Admin

An Admin handles normal ITC operations.

An Admin may approve applicants and manage activities, bookings, attendance, communications, and routine refunds.

An Admin may not manage Super Admins, payment credentials, system-critical integrations, destructive system operations, or application-wide data deletion.

### Super Admin

A Super Admin has every permission.

A Super Admin may manage all roles, system settings, integrations, sensitive data operations, and destructive actions.

## Core Information Architecture

### Home

The home page highlights the next relevant activity and current community information.

Free activities must use open-attendance language.

Paid activities must show price and booking status clearly.

### Activities

Activities must be visibly classified as Free or Paid.

The classification must be consistent across home, schedule, listing, and detail views.

Filters should make Free and Paid activities easy to distinguish.

### Wednesday Night Training

Wednesday Night Training is free.

Wednesday Night Training does not require booking.

Its page must not show capacity, remaining places, checkout, or booking actions.

Useful actions include View Details, Add to Calendar, and Get Directions.

### Weekly HYROX

Weekly ITC HYROX is a recurring paid launch activity.

Members purchase each session separately.

Each session uses the same fixed price.

The final price, capacity, schedule, location, cancellation policy, and refund policy are unresolved.

The expected member journey is:

1. View the HYROX session.
2. Review the price and session information.
3. Book and pay inside the application.
4. Receive confirmation and a receipt.
5. Manage the booking in the member area.

### Community

The product needs content introducing ITC leaders.

The product needs content explaining ITC culture, Christian foundation, purpose, values, safety expectations, and community guidelines.

Whether Leaders and Culture are one page or separate pages remains unresolved.

### Member Area

The member area should contain paid bookings, receipts, payment history, and profile information.

Saving free activities to a personal schedule is a proposed feature and is not confirmed.

### Administration

Administration must support applicant approval.

Administration must support activity creation and editing.

Administration must eventually support capacity, attendance, cancellations, refunds, and member communication.

The detailed permission matrix requires a later workshop.

## Signup Recommendation

The following recommendation is provisional.

Signup should collect only information required for safe participation, approval, and communication.

Recommended fields are full name, preferred name, email, mobile or WhatsApp number, age confirmation, emergency contact, and how the applicant heard about ITC.

Signup should require acceptance of the participation waiver, privacy policy, and community guidelines.

Photo or media consent should be optional and separately controlled.

Detailed medical information should not be collected without a confirmed operational and legal need.

Approval should check that the application is complete, plausible, non-duplicative, non-abusive, and compliant with applicable age or guardian requirements.

Approval should not depend on fitness level.

Final waiver language and approval criteria require later review.

## Selected Visual Direction

The selected direction is Version 1, “Night Circuit.”

The visual system comes from the existing Island Training Club website.

It uses black surfaces, a subtle technical grid, electric-lime accents, white typography, restrained rounded corners, the existing ITC logo, and real community photography.

The current mockups are conceptual and still show outdated booking language for Wednesday Night Training.

Future designs must correct that behavior before implementation.

## Deferred Or Unresolved

- Fixed HYROX price.
- HYROX capacity, weekly time, and location.
- Cancellation, refund, and no-show policy.
- Payment provider.
- Receipts, tax treatment, and accounting requirements.
- Member and leader notifications.
- Final signup fields and approval policy.
- Final waiver, privacy policy, and community-guideline copy.
- Detailed role and permission matrix.
- Exact member-only content.
- Final Leaders and Culture page structure.
- Saving free activities to a personal schedule.
- Phase-one success metrics.
- Merchandise launch scope, inventory, fulfilment, and returns.
- Legal, privacy, security, data-retention, and incident-response requirements.
- Detailed iOS and Android transition plan.

## Phase-One Non-Goals

Phase one does not include native iOS or Android applications.

Phase one does not yet commit to merchandise commerce.

Phase one does not include social feeds, chat, performance tracking, leaderboards, or broad fitness analytics.

Phase one should not add features merely to resemble a generic gym application.
