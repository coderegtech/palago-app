-- Phase 4c: the trip search projection.
--
-- Search needs a trip plus its operator, both terminals, the bus, and a live
-- count of bookable seats. Doing that from the client would be five queries and
-- then one seat count per trip — the classic N+1 — over a mobile connection.
--
-- `security_invoker = true` (Postgres 15+) makes the view run with the CALLER's
-- privileges rather than the owner's, so the RLS policies on trips, routes,
-- terminals, operators and buses all still apply. Without it a view would
-- quietly become a way around them.

create view public.trip_search with (security_invoker = true) as
select
  t.id,
  t.trip_number,
  t.departure_date,
  t.departure_time,
  t.arrival_time,
  t.fare,
  t.status,
  t.operator_id,
  o.name  as operator_name,
  o.code  as operator_code,
  t.route_id,
  r.duration_minutes,
  r.distance_km,
  r.origin_terminal_id,
  ot.name as origin_name,
  ot.code as origin_code,
  ot.city as origin_city,
  r.destination_terminal_id,
  dt.name as destination_name,
  dt.code as destination_code,
  dt.city as destination_city,
  t.bus_id,
  b.bus_number,
  b.bus_type,
  b.capacity,
  public.trip_available_seats(t.id) as available_seats
from public.trips t
join public.operators o on o.id = t.operator_id
join public.routes r on r.id = t.route_id
join public.terminals ot on ot.id = r.origin_terminal_id
join public.terminals dt on dt.id = r.destination_terminal_id
join public.buses b on b.id = t.bus_id;

comment on view public.trip_search is
  'Denormalised trip projection for search. Runs with the caller''s RLS.';

-- A view is not a table: it has no policies of its own and cannot be written
-- to. Grant read only, and only to signed-in users.
revoke all on public.trip_search from anon;
grant select on public.trip_search to authenticated;
