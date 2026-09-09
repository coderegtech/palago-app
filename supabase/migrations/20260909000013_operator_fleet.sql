-- Phase 7 follow-up: the fleet screen needs a scoped view too.
--
-- `buses` is readable by every signed-in user on purpose -- trip search shows
-- bus type and capacity -- so selecting from it directly hands the Cherry
-- operator RoRo's coaches. That is exactly what happened: the Fleet screen
-- listed RB-001 and RB-002 to a Cherry account in browser verification.
--
-- Same remedy as `operator_trip_overview` and `operator_manifest`: the filter
-- lives INSIDE the view, so a caller cannot forget it. `security_invoker` keeps
-- the caller's own RLS on the base table in force as well.

create view public.operator_fleet with (security_invoker = true) as
select
  b.id,
  b.operator_id,
  b.bus_number,
  b.plate_number,
  b.name,
  b.bus_type,
  b.capacity,
  b.status,
  b.created_at
from public.buses b
where b.operator_id = public.current_operator_id() or public.is_admin();

comment on view public.operator_fleet is
  'One operator''s own buses. Scoped inside the view because public.buses is world-readable for trip search.';

grant select on public.operator_fleet to authenticated;
