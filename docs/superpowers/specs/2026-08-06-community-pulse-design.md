# Community Pulse Design

Date: 2026-08-06  
Branch: `feature/community-page`  
Base: `main`

## Goal

Make the Community landing page cleaner and more engaging by replacing the uniform list of links with a personalized, action-oriented Community Pulse. This remains a pre-production prototype for team discussion.

## Audience and personalized introduction

The page uses the current account state to set its main heading:

- Visitor: **“Find your place in the crew.”**
- Pending applicant: **“You’re welcome here.”**
- Approved member: **“Connect and grow with us.”**

The supporting copy remains welcoming to people of any belief and explains that training is the doorway into the wider ITC community.

## Page hierarchy

1. **Next connection** — feature the existing post-training meal placeholder and provide “Count me in” and “View details” actions.
2. **Latest from ITC** — show the newest item from the existing announcements source and link to all announcements.
3. **Ways to connect** — prominent Prayer and Fellowship cards with concise descriptions and direct navigation.
4. **Explore** — compact links to Meals, Announcements, and About Island Training Club.

This hierarchy is provisional and will be reviewed with the ITC team.

## Visual direction

Use the selected Night Circuit identity: black technical surface, electric-lime accents, compact uppercase labels, strong typography, and restrained borders. Increase engagement through hierarchy and clear calls to action rather than decorative metrics.

The layout should:

- give the featured connection the strongest visual weight;
- use a two-column action grid where space permits and a single column on narrow screens;
- keep the latest announcement easy to scan;
- provide generous spacing and avoid competing visual elements;
- use Community-scoped CSS so existing Profile link cards do not change;
- preserve accessible link/button semantics and visible focus states.

No fake participation, activity, or unread counts will be shown.

## Data and behavior

- Reuse the current user and approval state from `store.js` for personalization.
- Reuse the existing `ANNOUNCEMENTS` seed data; select the newest announcement without duplicating its content.
- Reuse existing Community routes and the current mocked `connect-interest` action.
- Keep all Community subpages and prayer submission behavior unchanged.
- Do not add backend integration, admin content management, or a localStorage migration.

## Files and boundaries

- `app/js/views.js`: render personalized heading and Community Pulse sections.
- `app/styles.css`: add responsive, Community-scoped component styling.
- `app/smoke.mjs`: verify personalization, genuine announcement content, routes, and primary actions.

No Shop or Giving files will be changed.

## Error and empty handling

The seeded prototype currently has announcements. The landing page should still render safely if that collection is empty by showing a concise “No announcements yet” state and retaining the link to the announcements page.

## Verification

Use test-driven development:

1. Add smoke assertions for visitor, pending, and approved headings and confirm the new assertions fail before implementation.
2. Add assertions that the landing page uses existing announcement content and preserves all five Community destinations.
3. Add assertions for the featured meal actions and empty-announcement fallback where practical.
4. Implement the minimal view and CSS changes needed to pass.
5. Run `node app/smoke.mjs` from the worktree root.
6. Inspect the Community page at mobile and wider viewport sizes.

## Out of scope

- Production backend or CMS integration
- Real notifications or attendance tracking
- Fake engagement statistics
- Changes to Community subpage flows
- Changes to the Shop, Giving, Schedule, Profile, or Admin experiences
