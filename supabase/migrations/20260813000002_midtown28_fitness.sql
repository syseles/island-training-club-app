-- Correct the exact historical Midtown venue without overwriting
-- independently administered operational values.

update public.operational_activity_templates
   set venue = 'Midtown28 Fitness'
 where activity_id = 'hyrox-midtown'
   and venue = 'Midtown 28';

update public.operational_sessions
   set venue = 'Midtown28 Fitness'
 where activity_id = 'hyrox-midtown'
   and venue = 'Midtown 28';

update public.operational_bookings as booking
   set snapshot = jsonb_set(
     booking.snapshot,
     '{venue}',
     to_jsonb('Midtown28 Fitness'::text),
     false
   )
 where booking.snapshot ->> 'venue' = 'Midtown 28'
   and exists (
     select 1
       from public.operational_sessions as session
      where session.id = booking.session_id
        and session.activity_id = 'hyrox-midtown'
   );
