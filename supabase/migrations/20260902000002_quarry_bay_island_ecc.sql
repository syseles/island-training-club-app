-- Island Training Club — Quarry Bay Island ECC venue label
--
-- Keeps the precise floor in member-facing session details while giving
-- Get directions a concise, unambiguous Google Maps destination.

update public.operational_activity_templates
   set venue = '10/F, Island ECC, Quarry Bay',
       maps_query = 'Island ECC, Quarry Bay, Hong Kong',
       updated_at = now()
 where activity_id = 'hyrox-quarry-bay';

update public.operational_sessions
   set venue = '10/F, Island ECC, Quarry Bay',
       updated_at = now()
 where activity_id = 'hyrox-quarry-bay'
   and session_date >= (now() at time zone 'Asia/Hong_Kong')::date;

-- Upcoming booking snapshots should agree with the corrected venue. Preserve
-- historical snapshots and any value that no longer matches the prior seed.
update public.operational_bookings booking
   set snapshot = case
         when booking.snapshot->>'venue' = '10/F, 633 King''s Road, Quarry Bay, Hong Kong'
           then jsonb_set(
             booking.snapshot,
             '{venue}',
             to_jsonb('10/F, Island ECC, Quarry Bay'::text),
             false
           )
         when booking.snapshot->>'location' = '10/F, 633 King''s Road, Quarry Bay, Hong Kong'
           then jsonb_set(
             booking.snapshot,
             '{location}',
             to_jsonb('10/F, Island ECC, Quarry Bay'::text),
             false
           )
         else booking.snapshot
       end,
       updated_at = now()
  from public.operational_sessions session
 where session.id = booking.session_id
   and session.activity_id = 'hyrox-quarry-bay'
   and session.session_date >= (now() at time zone 'Asia/Hong_Kong')::date;
