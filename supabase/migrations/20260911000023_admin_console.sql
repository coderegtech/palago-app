-- Admin console: platform-wide analytics, and a safe way to add a bus.
--
-- Everything an admin can *write* here was already permitted by the Phase 3a
-- policies ("Admins write operators", "Admins write terminals", and the routes
-- and buses policies that both end `or public.is_admin()`). This migration adds
-- no new write permissions — it adds the two things those policies cannot
-- express on their own:
--
--   * `admin_dashboard` — the operator console's figures are scoped through
--     `current_operator_id()`, and an admin has no operator, so
--     `operator_dashboard` correctly returns NO_OPERATOR for them. Platform
--     totals need to read across every operator at once, which only a
--     SECURITY DEFINER function can do without weakening the views.
--   * `create_bus` — a bus and its seat layout have to arrive together. A bus
--     with no `bus_seats` rows is sellable-looking but unbookable: the seat map
--     renders empty and `reserve_seats` has nothing to lock. That is a
--     cross-row invariant, which is exactly the line AGENTS.md draws between a
--     direct table write and an RPC.
--
-- Operators, terminals and routes stay direct RLS-guarded inserts. They are
-- standalone rows with no such invariant, and routing them through a function
-- would add a layer that enforces nothing the policy does not already.

-- ---------------------------------------------------------------------------
-- admin_dashboard
--
-- Platform totals for one day, plus the same figures broken out per operator so
-- Cherry and RoRo can be compared side by side. The arithmetic deliberately
-- mirrors `operator_trip_overview` — passengers count booking_passengers on
-- live bookings, revenue counts PAID payments only — so an admin's number for
-- an operator equals what that operator sees on their own dashboard.
-- ---------------------------------------------------------------------------

create or replace function public.admin_dashboard(p_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Mirrored by ON_TIME_GRACE_MINUTES in src/constants/config.ts.
  v_grace constant int := 15;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  with trip_stats as (
    select
      t.id,
      t.operator_id,
      t.status,
      t.actual_departure_at,
      b.capacity,
      case
        when t.actual_departure_at is null then null
        else (
          extract(epoch from (
            t.actual_departure_at
              - ((t.departure_date + t.departure_time) at time zone 'Asia/Manila')
          )) / 60
        )::int
      end as delay_minutes,
      (select count(*) from public.trip_seats ts
        where ts.trip_id = t.id and ts.status = 'BOOKED')::int as seats_booked,
      (select count(*) from public.bookings bk
         join public.booking_passengers bp on bp.booking_id = bk.id
        where bk.trip_id = t.id
          and bk.status in ('CONFIRMED', 'CHECKED_IN', 'BOARDED', 'ON_TRIP', 'COMPLETED')
      )::int as passengers,
      (select count(*) from public.bookings bk
         join public.booking_passengers bp on bp.booking_id = bk.id
        where bk.trip_id = t.id and bk.status in ('BOARDED', 'ON_TRIP', 'COMPLETED')
      )::int as boarded,
      (select coalesce(sum(p.amount), 0) from public.payments p
         join public.bookings bk on bk.id = p.booking_id
        where bk.trip_id = t.id and p.status = 'PAID')::int as revenue
    from public.trips t
    join public.buses b on b.id = t.bus_id
    where t.departure_date = p_date
  ),
  totals as (
    select
      count(*)::int as trips,
      coalesce(sum(passengers), 0)::int as passengers,
      coalesce(sum(boarded), 0)::int as boarded,
      coalesce(sum(seats_booked), 0)::int as seats_booked,
      coalesce(sum(capacity), 0)::int as capacity,
      coalesce(sum(revenue), 0)::int as revenue,
      count(*) filter (where status = 'SCHEDULED')::int as scheduled,
      count(*) filter (where status = 'BOARDING')::int as boarding,
      count(*) filter (where status in ('DEPARTED', 'ON_TRIP'))::int as in_transit,
      count(*) filter (where status in ('ARRIVED', 'COMPLETED'))::int as completed,
      count(*) filter (where status = 'CANCELLED')::int as cancelled,
      count(*) filter (where actual_departure_at is not null)::int as departed,
      case
        when count(*) filter (where actual_departure_at is not null) = 0 then null
        else round(
          100.0 * count(*) filter (where delay_minutes <= v_grace)
            / count(*) filter (where actual_departure_at is not null)
        )
      end as on_time
    from trip_stats
  ),
  per_operator as (
    select
      o.id,
      o.name,
      o.code,
      o.status,
      coalesce(s.trips, 0) as trips,
      coalesce(s.passengers, 0) as passengers,
      coalesce(s.boarded, 0) as boarded,
      coalesce(s.revenue, 0) as revenue,
      coalesce(s.seats_booked, 0) as seats_booked,
      coalesce(s.capacity, 0) as capacity,
      (select count(*) from public.buses bu where bu.operator_id = o.id)::int as buses,
      (select count(*) from public.routes r where r.operator_id = o.id)::int as routes,
      (select count(*) from public.drivers d where d.operator_id = o.id)::int as drivers
    from public.operators o
    left join (
      select
        operator_id,
        count(*)::int as trips,
        sum(passengers)::int as passengers,
        sum(boarded)::int as boarded,
        sum(revenue)::int as revenue,
        sum(seats_booked)::int as seats_booked,
        sum(capacity)::int as capacity
      from trip_stats
      group by operator_id
    ) s on s.operator_id = o.id
    order by o.name
  )
  select jsonb_build_object(
    'date', p_date,
    'today', jsonb_build_object(
      'trips', t.trips,
      'passengers', t.passengers,
      'boarded', t.boarded,
      'seatsBooked', t.seats_booked,
      'capacity', t.capacity,
      'revenue', t.revenue,
      'scheduled', t.scheduled,
      'boarding', t.boarding,
      'inTransit', t.in_transit,
      'completed', t.completed,
      'cancelled', t.cancelled,
      'departed', t.departed,
      'onTimeGraceMinutes', v_grace,
      'onTime', t.on_time
    ),
    'platform', jsonb_build_object(
      'operators', (select count(*) from public.operators)::int,
      'activeOperators', (select count(*) from public.operators where status = 'ACTIVE')::int,
      'terminals', (select count(*) from public.terminals)::int,
      'routes', (select count(*) from public.routes)::int,
      'buses', (select count(*) from public.buses)::int,
      'activeBuses', (select count(*) from public.buses where status = 'ACTIVE')::int,
      'drivers', (select count(*) from public.drivers)::int,
      'assistants', (select count(*) from public.assistants)::int,
      'passengerAccounts', (select count(*) from public.profiles where role = 'USER')::int,
      -- Lifetime, not today: a platform's booking and revenue history is the
      -- figure an admin is actually looking for here.
      'bookingsAllTime', (select count(*) from public.bookings)::int,
      'revenueAllTime', (select coalesce(sum(amount), 0) from public.payments
                          where status = 'PAID')::int
    ),
    'operators', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', po.id,
        'name', po.name,
        'code', po.code,
        'status', po.status,
        'trips', po.trips,
        'passengers', po.passengers,
        'boarded', po.boarded,
        'revenue', po.revenue,
        'seatsBooked', po.seats_booked,
        'capacity', po.capacity,
        'buses', po.buses,
        'routes', po.routes,
        'drivers', po.drivers
      ))
      from per_operator po
    ), '[]'::jsonb)
  )
  into v_result
  from totals t;

  return v_result;
end;
$$;

revoke all on function public.admin_dashboard(date) from public, anon;
grant execute on function public.admin_dashboard(date) to authenticated;

-- ---------------------------------------------------------------------------
-- create_bus
--
-- Inserts the coach and generates its seat layout in one transaction.
--
-- The layout is the same 2+2 the seed builds: columns 1-2, aisle, columns 3-4,
-- row 1 priority. Generated from `capacity` rather than supplied, so the two
-- cannot disagree — a bus advertising 44 seats with 40 rows of seat map is a
-- double-booking waiting to happen.
--
-- Authorised for an admin, or for an operator adding a coach to their own
-- fleet. That is the same rule the `buses` RLS policy states; it is repeated
-- here because SECURITY DEFINER bypasses the policy, so the function must carry
-- the check itself.
-- ---------------------------------------------------------------------------

create or replace function public.create_bus(
  p_operator_id uuid,
  p_plate_number text,
  p_bus_number text,
  p_capacity integer,
  p_bus_type public.bus_type default 'BUS',
  p_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bus public.buses%rowtype;
  v_seats int;
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_operator_id is null
     or coalesce(trim(p_plate_number), '') = ''
     or coalesce(trim(p_bus_number), '') = ''
     or p_capacity is null or p_capacity < 1 or p_capacity > 100 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- `coalesce(…, false)` is load-bearing. `current_operator_id()` is NULL for a
  -- passenger, so the bare comparison yields NULL, `false or NULL` is NULL, and
  -- `if not NULL` does not branch — which let any signed-in passenger add a bus
  -- to any operator's fleet. Three-valued logic, caught by verify-admin.
  if not coalesce(
       public.is_admin() or p_operator_id = public.current_operator_id(),
       false
     ) then
    raise exception 'FORBIDDEN';
  end if;

  if not exists (select 1 from public.operators where id = p_operator_id) then
    raise exception 'NOT_FOUND';
  end if;

  begin
    insert into public.buses (operator_id, plate_number, bus_number, name, bus_type, capacity)
    values (
      p_operator_id, trim(p_plate_number), trim(p_bus_number),
      nullif(trim(coalesce(p_name, '')), ''), p_bus_type, p_capacity
    )
    returning * into v_bus;
  exception when unique_violation then
    -- Plate numbers are unique platform-wide, bus numbers within an operator.
    raise exception 'VALIDATION_ERROR';
  end;

  insert into public.bus_seats (
    bus_id, seat_number, row_number, column_number, seat_type, is_window, is_aisle
  )
  select
    v_bus.id,
    s.row_number || chr(64 + s.column_number),
    s.row_number,
    s.column_number,
    case when s.row_number = 1 then 'PRIORITY' else 'REGULAR' end::public.seat_type,
    s.column_number in (1, 4),
    s.column_number in (2, 3)
  from (
    select gs.row_number, gc.column_number
    from generate_series(1, ceil(v_bus.capacity / 4.0)::int) as gs(row_number)
    cross join generate_series(1, 4) as gc(column_number)
  ) s
  where (s.row_number - 1) * 4 + s.column_number <= v_bus.capacity;

  get diagnostics v_seats = row_count;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()), 'BUS_CREATED', 'bus', v_bus.id,
    jsonb_build_object('operatorId', p_operator_id, 'capacity', v_bus.capacity, 'seats', v_seats)
  );

  return jsonb_build_object(
    'id', v_bus.id,
    'plateNumber', v_bus.plate_number,
    'busNumber', v_bus.bus_number,
    'capacity', v_bus.capacity,
    'seats', v_seats
  );
end;
$$;

revoke all on function public.create_bus(uuid, text, text, integer, public.bus_type, text)
  from public, anon;
grant execute on function public.create_bus(uuid, text, text, integer, public.bus_type, text)
  to authenticated;
