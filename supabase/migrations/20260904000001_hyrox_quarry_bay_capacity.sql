-- Island Training Club — expand every Quarry Bay HYROX session
--
-- Capacity is intentionally updated on the template and every materialized
-- session row, including historical rows, per the approved capacity change.

update public.operational_activity_templates
   set capacity = 30,
       updated_at = now()
 where activity_id = 'hyrox-quarry-bay';

update public.operational_sessions
   set capacity = 30,
       updated_at = now()
 where activity_id = 'hyrox-quarry-bay';
