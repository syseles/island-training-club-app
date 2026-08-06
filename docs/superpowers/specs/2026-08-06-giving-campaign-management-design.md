# Giving Campaign Management Design

Date: 2026-08-06
Branch: `feature/giving-page`

## Goal

Remove all Giving demo data, let Admin/Super Admin manage one live campaign at a time, and notify approved members and administrators on first publication.

## Empty and Member Experience

Fresh state contains no campaigns and no donations. Remove the Standard Chartered Marathon campaign, HK$18,450 base amount, and seed donations `d-seed-1`/`d-seed-2`.

When no campaign is published, approved members see:

- “No active campaign right now”
- No campaign progress, amount presets, FPS details, QR placeholder, or transfer action
- Genuine historical donations only when they exist

When a campaign is published, the existing FPS prototype flow uses that campaign’s ID/title/goal/payee/FPS ID. Progress starts at HK$0 and sums genuine locally recorded donations for that campaign. There is no fabricated base amount.

Pending/declined Giving locks and visitor redirect remain unchanged.

## One-Campaign Workflow

Admin Tools gains a **Giving** tab.

Admin/Super Admin may:

- Create a draft
- Edit a draft
- Publish a valid draft
- Edit descriptive/payment details while published
- Close a published campaign after confirmation
- View closed campaign history
- Create a new draft after closure

At most one campaign may be Draft or Published at a time; older campaigns must be Closed. Closed campaigns are immutable and cannot be republished in this prototype.

Required fields: title, description, positive whole-HKD goal, FPS ID, and FPS payee. Publishing validates every required field. Destructive Close names the campaign in its confirmation. All async actions disable controls, use truthful progress labels, and separate mutation success from refresh failure.

## Storage

### Live mode

Create `public.giving_campaigns` in a new additive migration after Notification migration `00010`:

- UUID ID
- title/description
- positive integer `goal_hkd`
- `fps_id` and `fps_payee`
- status: `draft`, `published`, `closed`
- creator profile
- created/updated/published/closed timestamps

Use a partial unique index to permit only one Published campaign. A transition trigger allows Draft→Draft/Published, Published→Published/Closed, and Closed→Closed only. Admin/Super Admin can read and mutate all campaigns; approved members can read Published campaigns; pending/declined/visitors cannot read campaigns. No browser DELETE permission exists.

### Local prototype mode

Bump local state version and add `campaigns: []`. Migration removes only known seed donation IDs and preserves genuine donations. Campaign edits remain within `store.js`, matching existing local Admin activity behavior.

Live campaign metadata is shared through Supabase. Donation recording remains the existing mocked/local prototype seam; real payment/reconciliation remains out of scope.

## Publication Notification

The Giving domain owns the event; generic filtering/display remains in `feature/notification`.

On first Draft→Published transition, a security-definer database trigger inserts one `giving_campaign_published` notification for every current profile with role `member`, `admin`, or `super_admin`. Pending and declined profiles are excluded. Copy:

- Title: “New Giving campaign”
- Body: `ITC published “<campaign title>”.`
- Destination: `#/giving`
- Category: Club updates

Editing a Published campaign creates no duplicate. Closed campaigns cannot republish. The actor receives the event if their current role is Admin/Super Admin.

## Code Boundaries

- `data.js`: remove campaign/donation seeds.
- `store.js`: state migration plus local/live campaign actions and active campaign lookup.
- `views.js`: member empty/active views, Admin Giving tab/list/form.
- `app.js`: async Giving render, campaign routes/forms/publish/close actions.
- New Supabase migration: table, RLS, transition/publication triggers.
- Smoke and database integration tests: migration, transitions, audience, no duplicates, RLS, seed cleanup, admin/member views.

## Commit Boundaries

1. Remove demo campaign/donation state and migrate persisted seeds.
2. Add Supabase campaign schema, transitions, RLS, and publication notifications.
3. Add Admin campaign management and member empty/active flows.

Archivo and Notification filter changes arrive through their existing branch commits/merge and are not duplicated.

## Testing

Cover fresh/migrated local state, genuine donation preservation, no active member view, draft invisibility, complete published flow, one-open-campaign validation, closed immutability, Admin forms/actions/confirmations/errors, live RLS, first-publication fan-out to member/admin/super only, no pending/declined recipient, no duplicate on edit, no republish, and complete existing smoke suites.
