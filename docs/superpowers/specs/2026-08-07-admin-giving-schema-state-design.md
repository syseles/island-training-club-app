# Admin Giving Missing-Schema State Design

**Date:** 2026-08-07
**Source branch:** `feature/giving-page`
**Integration target:** `testing`

## Goal

Replace the raw PostgREST `PGRST205` failure on Admin Tools → Giving with a clear setup-required state, while preserving real database errors and existing campaign management/history behavior.

## Verified Root Cause

Admin Tools → Giving calls `viewAdmin("giving")`, which awaits `store.listGivingCampaigns()`. In live mode that queries `public.giving_campaigns` and throws any Supabase error. The deployed Supabase project currently returns `PGRST205` because the table does not exist. The table is defined in `20260805000011_giving_campaigns.sql`, but that migration has not been applied remotely.

## Admin States

### Schema missing

For exact PostgREST code `PGRST205`, Admin Giving renders:

- Heading: `Giving setup required`
- Explanation: campaign management becomes available after the Giving schema migration is applied.
- The two required migration filenames.
- No create/edit/publish/close controls and no campaign history, because the table does not exist.

### Schema installed, no campaigns

Existing behavior remains:

- `No Giving campaigns yet.`
- `+ Create campaign`

### Campaign records exist

Existing behavior remains:

- Draft/published/closed campaigns appear in the campaign list.
- Closed campaigns serve as campaign history.
- A new campaign can be created only when no draft or published campaign exists.

## Error Boundary

- `listGivingCampaigns()` continues throwing database errors; the store does not pretend a missing table is an empty campaign list.
- The Admin view catches only `error.code === "PGRST205"` and renders the setup-required state.
- RLS, authentication, network, and all other query errors continue through the existing route error feedback.
- Member Giving keeps its existing `PGRST205 → no active campaign` behavior.

## Operational Recovery

Functional Giving still requires an authorized operator to apply, in order:

1. `supabase/migrations/20260805000011_giving_campaigns.sql`
2. `supabase/migrations/20260806000001_donor_id.sql`

If PostgREST remains stale after applying the migrations, the operator may execute:

```sql
NOTIFY pgrst, 'reload schema';
```

After installation, Admin Giving automatically moves to the existing no-campaign or campaign-list state. No fake campaign data is restored.

## Tests

- Exact `PGRST205` renders the setup-required Admin state.
- Setup-required state includes both migration filenames and excludes campaign controls/history.
- An empty successful response renders `No Giving campaigns yet.` and `+ Create campaign`.
- Existing closed campaigns render as history and allow creating a new campaign.
- Draft/published campaigns suppress creating a second open campaign.
- A non-`PGRST205` error remains rejected.
- Existing member Giving, Payment/Auth, Notifications, Community, state v13, and safety tests remain green.

## Non-Goals

- Applying remote migrations without authorized database access.
- Reintroducing fake campaigns or donations.
- Treating the missing table as a successful empty campaign list.
- Changing campaign transition, RLS, or notification fan-out behavior.
