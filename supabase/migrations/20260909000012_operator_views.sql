-- Phase 7: the operator console's read model.
--
-- A dashboard is where N+1 queries breed: one query for trips, then a count per
-- trip, then a revenue lookup per trip. Over a Palawan mobile connection that
-- is unusable. These aggregate server-side and return one row per thing shown.
--
-- IMPORTANT ON SCOPE: `trips` is readable by every signed-in user, because trip
-- search needs it. RLS therefore does NOT scope these to one operator, so the
-- filter is built INTO the views rather than left to the caller. Leaving it to
-- callers is a footgun that leaks a rival's revenue the first time someone
-- forgets a `.eq('operator_id', …)` — which happened within minutes of writing
-- these, in the smoke test for this very migration.

-- ---------------------------------------------------------------------------
-- Trip overview
--
-- One row per departure with its crew and its live counts.
-- `security_invoker` so the caller's RLS still applies to every base table.
-- ---------------------------------------------------------------------------

create view public.operator_trip_overview with (security_invoker = true) as
select
  t.id,
  t.operator_id,
  t.trip_number,
  t.departure_date,
  t.departure_time,
  t.arrival_time,
  t.status,
  t.fare,
  b.id   as bus_id,
  b.bus_number,
  b.bus_type,
  b.capacity,
  ot.code as origin_code,
  ot.name as origin_name,
  dt.code as destination_code,
  dt.name as destination_name,
  r.duration_minutes,
  d.id   as driver_id,
  d.name as driver_name,
  d.phone as driver_phone,
  a.id   as assistant_id,
  a.name as assistant_name,
  a.phone as assistant_phone,
  ta.status as assignment_status,
  -- Seat inventory, counted once rather than per row in the client.
  (select count(*) from public.trip_seats ts
    where ts.trip_id = t.id and ts.status = 'BOOKED')::int as seats_booked,
  (select count(*) from public.trip_seats ts
    where ts.trip_id = t.id and ts.status = 'HELD')::int as seats_held,
  public.trip_available_seats(t.id) as seats_available,
  -- Passengers, and how many of them are actually aboard.
  (select count(*) from public.bookings bk
     join public.booking_passengers bp on bp.booking_id = bk.id
    where bk.trip_id = t.id
      and bk.status in ('CONFIRMED', 'CHECKED_IN', 'BOARDED', 'ON_TRIP', 'COMPLETED')
  )::int as passenger_count,
  (select count(*) from public.bookings bk
     join public.booking_passengers bp on bp.booking_id = bk.id
    where bk.trip_id = t.id and bk.status in ('BOARDED', 'ON_TRIP', 'COMPLETED')
  )::int as boarded_count,
  -- Test money only. Labelled as such everywhere it is displayed.
  (select coalesce(sum(p.amount), 0) from public.payments p
     join public.bookings bk on bk.id = p.booking_id
    where bk.trip_id = t.id and p.status = 'PAID'
  )::int as revenue
from public.trips t
join public.buses b on b.id = t.bus_id
join public.routes r on r.id = t.route_id
join public.terminals ot on ot.id = r.origin_terminal_id
join public.terminals dt on dt.id = r.destination_terminal_id
left join public.trip_assignments ta
  on ta.trip_id = t.id and ta.status in ('ASSIGNED', 'ACTIVE')
left join public.drivers d on d.id = ta.driver_id
left join public.assistants a on a.id = ta.assistant_id
-- Scoped here, not by the caller. A passenger or a rival operator sees nothing.
where t.operator_id = public.current_operator_id() or public.is_admin();

comment on view public.operator_trip_overview is
  'Per-departure operational summary, scoped to the caller''s own operator.';

revoke all on public.operator_trip_overview from anon;
grant select on public.operator_trip_overview to authenticated;

-- ---------------------------------------------------------------------------
-- Passenger manifest
--
-- One row per passenger per booking: who, which seat, paid or not, aboard or
-- not. `booking_passengers` is already restricted by RLS to the operator's own
-- trips, so this view inherits that scoping.
-- ---------------------------------------------------------------------------

create view public.operator_manifest with (security_invoker = true) as
select
  bp.id,
  bk.trip_id,
  bk.id as booking_id,
  bk.booking_reference,
  bk.status as booking_status,
  bp.passenger_name,
  bp.passenger_type,
  bp.phone,
  bs.seat_number,
  bs.row_number,
  bs.column_number,
  bk.boarded_at,
  bk.checked_in_at,
  coalesce(
    (select p.status::text from public.payments p
      where p.booking_id = bk.id
      order by case when p.status = 'PAID' then 0 else 1 end
      limit 1),
    'NONE'
  ) as payment_status
from public.booking_passengers bp
join public.bookings bk on bk.id = bp.booking_id
join public.bus_seats bs on bs.id = bp.seat_id
join public.trips t on t.id = bk.trip_id
-- Operator-scoped for the same reason as above. `booking_passengers` RLS also
-- lets a passenger read their own rows, which would otherwise show up here.
where t.operator_id = public.current_operator_id() or public.is_admin();

comment on view public.operator_manifest is
  'Passenger manifest, scoped to the caller''s own operator.';

revoke all on public.operator_manifest from anon;
grant select on public.operator_manifest to authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard totals
--
-- SECURITY DEFINER with an explicit role check, because it aggregates across
-- an operator's whole day — including revenue — and must not be callable by a
-- passenger who can otherwise read `trips`.
--
-- Deliberately ABSENT: an on-time rate. Nothing in the schema records actual
-- departure against scheduled departure, so any figure would be invented.
-- Trip-status counts are returned instead, which are real. Phase 8's GPS gives
-- the data a genuine on-time rate needs.
-- ---------------------------------------------------------------------------

create or replace function public.operator_dashboard(p_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_operator uuid := public.current_operator_id();
  v_is_admin boolean := public.is_admin();
  v_role public.user_role := public.current_profile_role();
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHORIZED';
  end if;

  -- An admin with no operator of their own sees nothing rather than everything;
  -- a cross-operator view is a separate admin feature, not this one.
  if v_operator is null then
    if v_is_admin then
      return jsonb_build_object('scope', 'NO_OPERATOR', 'date', p_date);
    end if;
    raise exception 'FORBIDDEN';
  end if;

  if v_role not in ('OPERATOR', 'DRIVER', 'ASSISTANT', 'ADMIN') then
    raise exception 'FORBIDDEN';
  end if;

  select jsonb_build_object(
    'scope', 'OPERATOR',
    'date', p_date,
    'operatorId', v_operator,
    'today', jsonb_build_object(
      'trips', count(*),
      'passengers', coalesce(sum(o.passenger_count), 0),
      'boarded', coalesce(sum(o.boarded_count), 0),
      'seatsBooked', coalesce(sum(o.seats_booked), 0),
      'capacity', coalesce(sum(o.capacity), 0),
      'revenue', coalesce(sum(o.revenue), 0),
      'scheduled', count(*) filter (where o.status = 'SCHEDULED'),
      'boarding', count(*) filter (where o.status = 'BOARDING'),
      'inTransit', count(*) filter (where o.status in ('DEPARTED', 'ON_TRIP')),
      'completed', count(*) filter (where o.status in ('ARRIVED', 'COMPLETED')),
      'cancelled', count(*) filter (where o.status = 'CANCELLED'),
      'unassigned', count(*) filter (where o.driver_id is null)
    )
  )
  into v_result
  from public.operator_trip_overview o
  where o.departure_date = p_date;

  -- Fleet and crew are not date-scoped.
  v_result := v_result || jsonb_build_object(
    'fleet', jsonb_build_object(
      'buses', (select count(*) from public.buses where operator_id = v_operator),
      'activeBuses', (select count(*) from public.buses
                       where operator_id = v_operator and status = 'ACTIVE')
    ),
    'crew', jsonb_build_object(
      'drivers', (select count(*) from public.drivers where operator_id = v_operator),
      'activeDrivers', (select count(*) from public.drivers
                         where operator_id = v_operator and status = 'ACTIVE'),
      'assistants', (select count(*) from public.assistants where operator_id = v_operator),
      'activeAssistants', (select count(*) from public.assistants
                            where operator_id = v_operator and status = 'ACTIVE')
    )
  );

  return v_result;
end;
$$;

revoke all on function public.operator_dashboard(date) from public, anon;
grant execute on function public.operator_dashboard(date) to authenticated;
