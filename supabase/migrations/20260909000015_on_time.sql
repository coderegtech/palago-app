-- Phase 8: the on-time rate Phase 7 refused to invent.
--
-- Phase 7's dashboard says, on screen: "On-time performance needs actual
-- departure times, which arrive with GPS tracking in Phase 8. Nothing is
-- estimated here." `trips.actual_departure_at` now exists, so the figure can be
-- computed from two real timestamps instead of guessed.
--
-- Definition, stated once so the UI and the SQL cannot drift: a trip is on time
-- if it actually departed no more than ON_TIME_GRACE_MINUTES after its
-- scheduled departure. Trips that have not departed are not counted at all —
-- neither as on time nor as late — because a bus that has not left yet is not
-- yet either.

-- ---------------------------------------------------------------------------
-- Expose the actual times on the operator's trip view.
--
-- Appended at the end: `create or replace view` may add trailing columns but
-- cannot reorder or retype existing ones, and dropping the view would take
-- `operator_dashboard` and the app's generated types with it.
-- ---------------------------------------------------------------------------

create or replace view public.operator_trip_overview with (security_invoker = true) as
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
  (select count(*) from public.trip_seats ts
    where ts.trip_id = t.id and ts.status = 'BOOKED')::int as seats_booked,
  (select count(*) from public.trip_seats ts
    where ts.trip_id = t.id and ts.status = 'HELD')::int as seats_held,
  public.trip_available_seats(t.id) as seats_available,
  (select count(*) from public.bookings bk
     join public.booking_passengers bp on bp.booking_id = bk.id
    where bk.trip_id = t.id
      and bk.status in ('CONFIRMED', 'CHECKED_IN', 'BOARDED', 'ON_TRIP', 'COMPLETED')
  )::int as passenger_count,
  (select count(*) from public.bookings bk
     join public.booking_passengers bp on bp.booking_id = bk.id
    where bk.trip_id = t.id and bk.status in ('BOARDED', 'ON_TRIP', 'COMPLETED')
  )::int as boarded_count,
  (select coalesce(sum(p.amount), 0) from public.payments p
     join public.bookings bk on bk.id = p.booking_id
    where bk.trip_id = t.id and p.status = 'PAID'
  )::int as revenue,
  -- Phase 8 additions.
  t.actual_departure_at,
  t.actual_arrival_at,
  -- Minutes late at departure, negative if early. Null until it departs, which
  -- is what keeps an undeparted trip out of the on-time average.
  case
    when t.actual_departure_at is null then null
    else (
      extract(epoch from (
        t.actual_departure_at
          - ((t.departure_date + t.departure_time) at time zone 'Asia/Manila')
      )) / 60
    )::int
  end as departure_delay_minutes
from public.trips t
join public.buses b on b.id = t.bus_id
join public.routes r on r.id = t.route_id
join public.terminals ot on ot.id = r.origin_terminal_id
join public.terminals dt on dt.id = r.destination_terminal_id
left join public.trip_assignments ta
  on ta.trip_id = t.id and ta.status in ('ASSIGNED', 'ACTIVE')
left join public.drivers d on d.id = ta.driver_id
left join public.assistants a on a.id = ta.assistant_id
where t.operator_id = public.current_operator_id() or public.is_admin();

comment on column public.operator_trip_overview.departure_delay_minutes is
  'Minutes between scheduled and actual departure; negative if early, null if not yet departed. Schedule is interpreted in Asia/Manila.';

-- ---------------------------------------------------------------------------
-- Dashboard
--
-- `onTime` is null, not zero, when nothing has departed. Zero would read as
-- "every bus was late today" on a morning when none has left the terminal.
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
  -- A bus is "on time" if it left within this many minutes of schedule.
  -- Mirrored by ON_TIME_GRACE_MINUTES in src/constants/config.ts.
  v_grace constant int := 15;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHORIZED';
  end if;

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
      'unassigned', count(*) filter (where o.driver_id is null),
      -- Real figures now, from two recorded timestamps.
      'departed', count(*) filter (where o.actual_departure_at is not null),
      'onTimeGraceMinutes', v_grace,
      'onTime', case
        when count(*) filter (where o.actual_departure_at is not null) = 0 then null
        else round(
          100.0
            * count(*) filter (where o.departure_delay_minutes <= v_grace)
            / count(*) filter (where o.actual_departure_at is not null)
        )
      end,
      'avgDelayMinutes', (
        select round(avg(o2.departure_delay_minutes))
        from public.operator_trip_overview o2
        where o2.departure_date = p_date and o2.actual_departure_at is not null
      )
    )
  )
  into v_result
  from public.operator_trip_overview o
  where o.departure_date = p_date;

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
