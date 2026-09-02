-- Island Training Club — canonical BFT id and Quarry Bay HYROX
--
-- Renames the ambiguous recurring `hyrox` activity/session ids to
-- `hyrox-bft`, preserving all dependent operational records, then adds the
-- approved open-by-default Quarry Bay recurring session.

-- Permit the two explicit venue ids alongside Midtown, lunch, and one-offs.
alter table public.operational_activity_templates
  drop constraint operational_activity_templates_activity_id_check;
alter table public.operational_activity_templates
  add constraint operational_activity_templates_activity_id_check
  check (
    activity_id in ('hyrox', 'hyrox-bft', 'hyrox-midtown', 'hyrox-quarry-bay', 'lunch')
    or activity_id like 'event-%'
  );

-- The original foreign keys were immediate and did not cascade updates.
-- Defer them within this transaction so the parent and every child reference
-- can move together without dropping referential integrity.
alter table public.operational_sessions
  alter constraint operational_sessions_activity_id_fkey
  deferrable initially deferred;
alter table public.operational_bookings
  alter constraint operational_bookings_session_id_fkey
  deferrable initially deferred;
alter table public.operational_queue_entries
  alter constraint operational_queue_entries_session_id_fkey
  deferrable initially deferred;
alter table public.operational_receipts
  alter constraint operational_receipts_session_id_fkey
  deferrable initially deferred;
alter table public.operational_rsvp_counts
  alter constraint operational_rsvp_counts_session_id_fkey
  deferrable initially deferred;
set constraints operational_sessions_activity_id_fkey,
  operational_bookings_session_id_fkey,
  operational_queue_entries_session_id_fkey,
  operational_receipts_session_id_fkey,
  operational_rsvp_counts_session_id_fkey deferred;

update public.operational_activity_templates
   set activity_id = 'hyrox-bft',
       updated_at = now()
 where activity_id = 'hyrox';

update public.operational_sessions
   set id = replace(id, 'hyrox-', 'hyrox-bft-'),
       activity_id = 'hyrox-bft',
       updated_at = now()
 where activity_id = 'hyrox';

update public.operational_bookings
   set session_id = replace(session_id, 'hyrox-', 'hyrox-bft-'),
       snapshot = case
         when snapshot ? 'activity_id' then
           jsonb_set(snapshot, '{activity_id}', to_jsonb('hyrox-bft'::text), false)
         else snapshot
       end,
       updated_at = now()
 where session_id ~ '^hyrox-[0-9]{4}-[0-9]{2}-[0-9]{2}$';

update public.operational_queue_entries
   set session_id = replace(session_id, 'hyrox-', 'hyrox-bft-')
 where session_id ~ '^hyrox-[0-9]{4}-[0-9]{2}-[0-9]{2}$';

update public.operational_receipts
   set session_id = replace(session_id, 'hyrox-', 'hyrox-bft-')
 where session_id ~ '^hyrox-[0-9]{4}-[0-9]{2}-[0-9]{2}$';

update public.operational_rsvp_counts
   set session_id = replace(session_id, 'hyrox-', 'hyrox-bft-')
 where session_id ~ '^hyrox-[0-9]{4}-[0-9]{2}-[0-9]{2}$';

-- Preserve any already-materialized Activity Details notification links.
update public.notifications
   set destination = replace(destination, '#/activity/hyrox-', '#/activity/hyrox-bft-')
 where destination like '#/activity/hyrox-%';

-- Tighten the template id contract now that no canonical row uses `hyrox`.
alter table public.operational_activity_templates
  drop constraint operational_activity_templates_activity_id_check;
alter table public.operational_activity_templates
  add constraint operational_activity_templates_activity_id_check
  check (
    activity_id in ('hyrox-bft', 'hyrox-midtown', 'hyrox-quarry-bay', 'lunch')
    or activity_id like 'event-%'
  );

insert into public.operational_activity_templates
  (activity_id, name, venue, weekday, start_time, duration_minutes,
   capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
values
  ('hyrox-quarry-bay', 'ITC HYROX', '10/F, 633 King''s Road, Quarry Bay, Hong Kong',
   6, '11:00', 60, 12, 180, true, true, 'HYROX',
   '10/F, 633 King''s Road, Quarry Bay, Hong Kong', false)
on conflict (activity_id) do update
set name = excluded.name,
    venue = excluded.venue,
    weekday = excluded.weekday,
    start_time = excluded.start_time,
    duration_minutes = excluded.duration_minutes,
    capacity = excluded.capacity,
    price_hkd = excluded.price_hkd,
    default_open = excluded.default_open,
    active = excluded.active,
    category = excluded.category,
    maps_query = excluded.maps_query,
    requires_rsvp = excluded.requires_rsvp,
    updated_at = now();

-- Materialize the rolling window now; normal app hydration keeps extending it.
select count(*)
  from public.ensure_operational_sessions(
    (now() at time zone 'Asia/Hong_Kong')::date,
    16
  );

set constraints operational_sessions_activity_id_fkey,
  operational_bookings_session_id_fkey,
  operational_queue_entries_session_id_fkey,
  operational_receipts_session_id_fkey,
  operational_rsvp_counts_session_id_fkey immediate;

alter table public.operational_sessions
  alter constraint operational_sessions_activity_id_fkey not deferrable;
alter table public.operational_bookings
  alter constraint operational_bookings_session_id_fkey not deferrable;
alter table public.operational_queue_entries
  alter constraint operational_queue_entries_session_id_fkey not deferrable;
alter table public.operational_receipts
  alter constraint operational_receipts_session_id_fkey not deferrable;
alter table public.operational_rsvp_counts
  alter constraint operational_rsvp_counts_session_id_fkey not deferrable;
