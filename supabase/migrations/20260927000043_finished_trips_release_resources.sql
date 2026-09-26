-- A trip that has finished stops holding its coach and crew when it actually
-- finished, not when it was scheduled to.
--
-- The bug: `trips.blocked_range` — the window `trips_bus_no_overlap` reads — was
-- stamped from the SCHEDULED times only, and only when those times changed.
-- `end_trip` sets `status = 'ARRIVED'` and `actual_arrival_at = now()`, neither
-- of which the trigger looked at, so a coach that docked at 10:30 went on being
-- "occupied" until its scheduled 12:00 + 30 minutes of turnaround. Trying to
-- schedule it at 11:00 came back as "That clashes with CHERRY-002" — about a
-- trip that had finished half an hour earlier.
--
-- Deleting ARRIVED/COMPLETED rows from the constraint would be the wrong fix: a
-- finished trip DID occupy the coach until it docked, and a departure dated
-- before that moment is a real clash. So the window itself changes:
--
--     while SCHEDULED / BOARDING / DEPARTED / ON_TRIP   [departure, scheduled arrival + turnaround)
--     once ARRIVED / COMPLETED with an actual arrival   [departure, actual arrival    + turnaround)
--     CANCELLED, or withdrawn from sale                 not in the constraint at all
--
-- The actual arrival can only SHORTEN the window (`least`). A coach that docks
-- late cannot be allowed to widen its own window, because that widening runs
-- inside `end_trip`'s UPDATE and, if another departure had already been booked
-- into the gap, the exclusion constraint would refuse the update — a driver
-- would be unable to end a trip they had physically finished. The coach really
-- was late; the schedule already had the next trip booked into the overlap;
-- neither is a reason to leave the trip stuck on DEPARTED.
--
-- The crew follow the same window. `trip_assignments.blocked_range` is a copy of
-- its trip's, re-stamped by the existing trigger whenever the trip's window
-- moves, so a shortened trip shortens its assignments in the same statement.
-- `end_trip` also sets its assignments COMPLETED, which takes them out of the
-- (ASSIGNED, ACTIVE) exclusion constraints — that is what releases a driver the
-- moment the trip ends.
--
-- What the constraints cannot express is a departure dated BEFORE a finished
-- trip's actual arrival (backdating a trip onto a coach or a driver that was
-- genuinely still out). For the coach the trips constraint covers it; for the
-- crew this migration adds `trip_resource_conflict`, which reads COMPLETED
-- assignments too and is called before an assignment is written. A finished
-- assignment is a fact about the past that never changes, so unlike a live one
-- it needs no constraint to be safe under concurrency — and putting COMPLETED
-- into the constraint would fail this migration on any database whose history
-- has a driver rostered twice in overlapping windows.

-- ---------------------------------------------------------------------------
-- The window, in one place
--
-- `timestamp`, in Palawan's wall clock, like the rest of the schedule. The
-- actual arrival is a `timestamptz` and is converted with an explicit zone —
-- NOT the session's, which would make two clients disagree about what overlaps.
-- ---------------------------------------------------------------------------

create or replace function public.trip_blocked_range(
  p_departure_at timestamp,
  p_arrival_at timestamp,
  p_status text,
  p_actual_arrival_at timestamptz,
  p_turnaround_minutes integer
)
returns tsrange
language sql
immutable
as $$
  select tsrange(
    p_departure_at,
    case
      when p_status in ('ARRIVED', 'COMPLETED') and p_actual_arrival_at is not null
        then least(
               p_arrival_at,
               -- Never before the departure: a trip ended the moment it was
               -- started has an empty journey, not a negative one.
               greatest(p_departure_at, p_actual_arrival_at at time zone 'Asia/Manila')
             )
      else p_arrival_at
    end + make_interval(mins => p_turnaround_minutes),
    '[)'
  );
$$;

comment on function public.trip_blocked_range is
  'The window a trip holds its coach and crew for. Scheduled arrival while the trip is live; the actual arrival (never later than scheduled) once it has ended. Plus the turnaround buffer.';

create or replace function public.stamp_trip_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.departure_at := (new.departure_date + new.departure_time)::timestamp;
  new.arrival_at := public.trip_arrival_timestamp(
    new.departure_date, new.departure_time, new.arrival_time
  );
  new.blocked_range := public.trip_blocked_range(
    new.departure_at, new.arrival_at, new.status::text,
    new.actual_arrival_at, public.turnaround_minutes()
  );
  return new;
end;
$$;

-- Now also on the two columns that `end_trip` writes.
drop trigger trips_stamp_schedule on public.trips;
create trigger trips_stamp_schedule
  before insert or update of departure_date, departure_time, arrival_time, status, actual_arrival_at
  on public.trips
  for each row execute function public.stamp_trip_schedule();

-- Trips that have already ended. Only ever shortens a window, so it cannot
-- violate the exclusion constraint. `trips_set_updated_at` is held off: this is
-- a schema change, not somebody editing the schedule. The restamp trigger
-- carries each new window onto the trip's assignments.
alter table public.trips disable trigger trips_set_updated_at;

update public.trips t
   set blocked_range = public.trip_blocked_range(
         t.departure_at, t.arrival_at, t.status::text,
         t.actual_arrival_at, public.turnaround_minutes()
       )
 where t.status in ('ARRIVED', 'COMPLETED')
   and t.actual_arrival_at is not null;

alter table public.trips enable trigger trips_set_updated_at;

-- ---------------------------------------------------------------------------
-- Who is in the way
--
-- The one place that answers "is this coach / driver / conductor occupied during
-- this window, and by what". Create, edit, re-activate and crew assignment all
-- ask it, so they cannot disagree — and every answer says WHICH resource, which
-- trip, and until when, so the screen can say more than "that clashes".
--
-- Bus:    another live trip's window on the same coach.
-- Crew:   another assignment's window — including COMPLETED ones, whose window
--         has been shortened to the actual arrival.
-- Never:  the trip being edited (`p_exclude_trip_id`), so a trip cannot clash
--         with itself; CANCELLED trips; withdrawn schedules.
--
-- Bus first, then driver, then conductor, and within each the one that frees up
-- last — the constraint someone would hit is the one to name.
-- ---------------------------------------------------------------------------

create or replace function public.trip_resource_conflict(
  p_window tsrange,
  p_bus_id uuid,
  p_driver_id uuid,
  p_assistant_id uuid,
  p_exclude_trip_id uuid default null
)
returns table (resource text, label text, trip_number text, busy_until timestamp)
language sql
stable
security definer
set search_path = ''
as $$
  select c.resource, c.label, c.trip_number, c.busy_until
    from (
      select 'BUS'::text as resource, b.bus_number::text as label,
             t.trip_number::text as trip_number, upper(t.blocked_range) as busy_until,
             1 as rank
        from public.trips t
        join public.buses b on b.id = t.bus_id
       where p_bus_id is not null
         and t.bus_id = p_bus_id
         and t.id is distinct from p_exclude_trip_id
         and t.status <> 'CANCELLED'
         and t.is_active
         and t.blocked_range && p_window

      union all

      select 'DRIVER', d.name::text, t.trip_number::text, upper(ta.blocked_range), 2
        from public.trip_assignments ta
        join public.trips t on t.id = ta.trip_id
        join public.drivers d on d.id = ta.driver_id
       where p_driver_id is not null
         and ta.driver_id = p_driver_id
         and ta.trip_id is distinct from p_exclude_trip_id
         and ta.status in ('ASSIGNED', 'ACTIVE', 'COMPLETED')
         and t.status <> 'CANCELLED'
         and ta.blocked_range && p_window

      union all

      select 'ASSISTANT', a.name::text, t.trip_number::text, upper(ta.blocked_range), 3
        from public.trip_assignments ta
        join public.trips t on t.id = ta.trip_id
        join public.assistants a on a.id = ta.assistant_id
       where p_assistant_id is not null
         and ta.assistant_id = p_assistant_id
         and ta.trip_id is distinct from p_exclude_trip_id
         and ta.status in ('ASSIGNED', 'ACTIVE', 'COMPLETED')
         and t.status <> 'CANCELLED'
         and ta.blocked_range && p_window
    ) c
   order by c.rank, c.busy_until desc
   limit 1;
$$;

comment on function public.trip_resource_conflict is
  'The first bus, driver or conductor occupied during a window, with the trip holding them and when they are free. Reads effective (shortened-on-arrival) windows.';

-- Turns the answer into the error the client renders. `detail` stays the trip
-- number, exactly as before; `hint` carries the rest as JSON.
create or replace function public.raise_schedule_conflict(
  p_window tsrange,
  p_bus_id uuid,
  p_driver_id uuid,
  p_assistant_id uuid,
  p_exclude_trip_id uuid default null
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conflict record;
begin
  select * into v_conflict
    from public.trip_resource_conflict(
      p_window, p_bus_id, p_driver_id, p_assistant_id, p_exclude_trip_id
    );

  -- A constraint fired but the row that caused it is gone by the time we look —
  -- a concurrent cancel. Still a refusal; there is just nothing to name.
  if not found then
    raise exception 'SCHEDULE_CONFLICT';
  end if;

  raise exception 'SCHEDULE_CONFLICT'
    using detail = v_conflict.trip_number,
          hint = jsonb_build_object(
            'resource', v_conflict.resource,
            'label', v_conflict.label,
            'busyUntil', v_conflict.busy_until
          )::text;
end;
$$;

-- Internal. Callers are SECURITY DEFINER functions that have already authorised
-- the caller; exposed over RPC this would list a rival's trips and staff.
revoke all on function public.trip_blocked_range(timestamp, timestamp, text, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.trip_resource_conflict(tsrange, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.raise_schedule_conflict(tsrange, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_turnaround_minutes — the window comes from the same function
-- ---------------------------------------------------------------------------

create or replace function public.set_turnaround_minutes(p_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_before integer := public.turnaround_minutes();
  v_touched integer;
  v_clash text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_minutes is null or p_minutes < 0 or p_minutes > 720 then
    raise exception 'VALIDATION_ERROR';
  end if;

  update public.app_settings
     set value = p_minutes::text, updated_at = now()
   where key = 'trip_turnaround_minutes';

  begin
    update public.trips
       set blocked_range = public.trip_blocked_range(
             departure_at, arrival_at, status::text, actual_arrival_at, p_minutes
           )
     where departure_at >= now()::timestamp;
    get diagnostics v_touched = row_count;
  exception
    when exclusion_violation then
      -- Name the pair. "That would cause a conflict" leaves an admin hunting
      -- through a month of departures for a clash they cannot see.
      select a.trip_number || ' and ' || b.trip_number into v_clash
        from public.trips a
        join public.trips b
          on b.bus_id = a.bus_id
         and b.id > a.id
       where a.status <> 'CANCELLED' and a.is_active
         and b.status <> 'CANCELLED' and b.is_active
         and a.departure_at >= now()::timestamp
         and b.departure_at >= now()::timestamp
         and public.trip_blocked_range(
               a.departure_at, a.arrival_at, a.status::text, a.actual_arrival_at, p_minutes)
             && public.trip_blocked_range(
               b.departure_at, b.arrival_at, b.status::text, b.actual_arrival_at, p_minutes)
       -- Earliest first, so widening repeatedly walks forward through the
       -- clashes instead of naming an arbitrary one each time.
       order by a.departure_at
       limit 1;
      raise exception 'SCHEDULE_CONFLICT' using detail = coalesce(v_clash, '');
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'TURNAROUND_CHANGED', 'app_settings', null,
    jsonb_build_object('before', v_before, 'after', p_minutes, 'tripsRestamped', v_touched)
  );

  return jsonb_build_object('turnaroundMinutes', p_minutes, 'tripsRestamped', v_touched);
end;
$$;

revoke all on function public.set_turnaround_minutes(integer) from public, anon;
grant execute on function public.set_turnaround_minutes(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- create_trip — a clash names the resource, the trip and the time
-- ---------------------------------------------------------------------------

create or replace function public.create_trip(
  p_route_id uuid,
  p_bus_id uuid,
  p_trip_number text,
  p_departure_date date,
  p_departure_time time,
  p_arrival_time time,
  p_fare integer,
  -- Admins schedule for any operator; an operator always schedules their own.
  p_operator_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_operator_id uuid := coalesce(p_operator_id, public.current_operator_id());
  v_route public.routes%rowtype;
  v_bus public.buses%rowtype;
  v_operator public.operators%rowtype;
  v_trip_id uuid;
  v_departure_at timestamp;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if v_operator_id is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  if not (public.is_admin() or public.can_manage_operator(v_operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if coalesce(trim(coalesce(p_trip_number, '')), '') = ''
     or p_departure_date is null or p_departure_time is null or p_arrival_time is null
     or p_fare is null or p_fare <= 0 then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_operator from public.operators where id = v_operator_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_operator.status <> 'ACTIVE' then
    raise exception 'INACTIVE_RESOURCE';
  end if;

  select * into v_route from public.routes where id = p_route_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  -- Checked before the status, so a rival's route is "not yours", never
  -- "inactive" — the second answer would confirm it exists.
  if v_route.operator_id <> v_operator_id then
    raise exception 'FORBIDDEN';
  end if;
  if v_route.status <> 'ACTIVE' then
    raise exception 'INACTIVE_RESOURCE';
  end if;

  select * into v_bus from public.buses where id = p_bus_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_bus.operator_id <> v_operator_id then
    raise exception 'FORBIDDEN';
  end if;
  if v_bus.status <> 'ACTIVE' then
    raise exception 'INACTIVE_RESOURCE';
  end if;

  begin
    insert into public.trips (
      operator_id, route_id, bus_id, trip_number,
      departure_date, departure_time, arrival_time, fare
    )
    values (
      v_operator_id, p_route_id, p_bus_id, trim(p_trip_number),
      p_departure_date, p_departure_time, p_arrival_time, p_fare
    )
    returning id into v_trip_id;
  exception
    when exclusion_violation then
      v_departure_at := (p_departure_date + p_departure_time)::timestamp;
      perform public.raise_schedule_conflict(
        public.trip_blocked_range(
          v_departure_at,
          public.trip_arrival_timestamp(p_departure_date, p_departure_time, p_arrival_time),
          'SCHEDULED', null, public.turnaround_minutes()
        ),
        p_bus_id, null, null, null
      );
    when unique_violation then
      raise exception 'VALIDATION_ERROR';
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'TRIP_CREATED', 'trip', v_trip_id,
    jsonb_build_object(
      'operatorId', v_operator_id, 'routeId', p_route_id, 'busId', p_bus_id,
      'tripNumber', trim(p_trip_number), 'departureDate', p_departure_date,
      'departureTime', p_departure_time, 'arrivalTime', p_arrival_time, 'fare', p_fare
    )
  );

  return jsonb_build_object('id', v_trip_id, 'tripNumber', trim(p_trip_number));
end;
$$;

revoke all on function public.create_trip(uuid, uuid, text, date, time, time, integer, uuid)
  from public, anon;
grant execute on function public.create_trip(uuid, uuid, text, date, time, time, integer, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_trip
--
-- `p_exclude_trip_id` is this trip: it must not clash with itself. Moving it
-- also moves its crew's window (the restamp trigger), so the new times can
-- clash for the driver or conductor rather than the coach — the live
-- assignment is looked up so that is named too.
-- ---------------------------------------------------------------------------

create or replace function public.update_trip(
  p_trip_id uuid,
  p_route_id uuid,
  p_bus_id uuid,
  p_trip_number text,
  p_departure_date date,
  p_departure_time time,
  p_arrival_time time,
  p_fare integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_trip public.trips%rowtype;
  v_route public.routes%rowtype;
  v_bus public.buses%rowtype;
  v_driver_id uuid;
  v_assistant_id uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if not (public.is_admin() or public.can_manage_operator(v_trip.operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if v_trip.status <> 'SCHEDULED' then
    raise exception 'INVALID_TRIP_STATUS';
  end if;

  if coalesce(trim(coalesce(p_trip_number, '')), '') = ''
     or p_fare is null or p_fare <= 0 then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_route from public.routes where id = p_route_id;
  if not found or v_route.operator_id <> v_trip.operator_id then
    raise exception 'FORBIDDEN';
  end if;
  if v_route.status <> 'ACTIVE' then
    raise exception 'INACTIVE_RESOURCE';
  end if;

  select * into v_bus from public.buses where id = p_bus_id;
  if not found or v_bus.operator_id <> v_trip.operator_id then
    raise exception 'FORBIDDEN';
  end if;
  if v_bus.status <> 'ACTIVE' then
    raise exception 'INACTIVE_RESOURCE';
  end if;

  -- Changing the coach after seats have been sold would strand every seat
  -- assignment: `trip_seats` rows point at the old bus's `bus_seats`.
  if p_bus_id <> v_trip.bus_id and exists (
    select 1 from public.trip_seats ts
     where ts.trip_id = p_trip_id and ts.status in ('HELD', 'BOOKED')
  ) then
    raise exception 'SEAT_UNAVAILABLE';
  end if;

  begin
    update public.trips
       set route_id = p_route_id,
           bus_id = p_bus_id,
           trip_number = trim(p_trip_number),
           departure_date = p_departure_date,
           departure_time = p_departure_time,
           arrival_time = p_arrival_time,
           fare = p_fare
     where id = p_trip_id;
  exception
    when exclusion_violation then
      select ta.driver_id, ta.assistant_id into v_driver_id, v_assistant_id
        from public.trip_assignments ta
       where ta.trip_id = p_trip_id and ta.status in ('ASSIGNED', 'ACTIVE')
       limit 1;

      perform public.raise_schedule_conflict(
        public.trip_blocked_range(
          (p_departure_date + p_departure_time)::timestamp,
          public.trip_arrival_timestamp(p_departure_date, p_departure_time, p_arrival_time),
          'SCHEDULED', null, public.turnaround_minutes()
        ),
        p_bus_id, v_driver_id, v_assistant_id, p_trip_id
      );
    when unique_violation then
      raise exception 'VALIDATION_ERROR';
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'TRIP_UPDATED', 'trip', p_trip_id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'routeId', v_trip.route_id, 'busId', v_trip.bus_id,
        'tripNumber', v_trip.trip_number, 'departureDate', v_trip.departure_date,
        'departureTime', v_trip.departure_time, 'arrivalTime', v_trip.arrival_time,
        'fare', v_trip.fare
      ),
      'after', jsonb_build_object(
        'routeId', p_route_id, 'busId', p_bus_id,
        'tripNumber', trim(p_trip_number), 'departureDate', p_departure_date,
        'departureTime', p_departure_time, 'arrivalTime', p_arrival_time, 'fare', p_fare
      )
    )
  );

  return jsonb_build_object('id', p_trip_id, 'tripNumber', trim(p_trip_number));
end;
$$;

revoke all on function public.update_trip(uuid, uuid, uuid, text, date, time, time, integer)
  from public, anon;
grant execute on function public.update_trip(uuid, uuid, uuid, text, date, time, time, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- set_trip_active — reactivating can clash, and now says with what
-- ---------------------------------------------------------------------------

create or replace function public.set_trip_active(p_trip_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_trip public.trips%rowtype;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if not (public.is_admin() or public.can_manage_operator(v_trip.operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if v_trip.is_active = p_active then
    return jsonb_build_object('id', p_trip_id, 'isActive', p_active, 'changed', false);
  end if;

  if not p_active and exists (
    select 1 from public.bookings b
     where b.trip_id = p_trip_id
       and b.status in ('PENDING', 'PAYMENT_PENDING', 'CONFIRMED', 'CHECKED_IN')
  ) then
    raise exception 'VALIDATION_ERROR';
  end if;

  begin
    update public.trips set is_active = p_active where id = p_trip_id;
  exception
    when exclusion_violation then
      -- Reactivating can clash: the coach may have been given to another trip
      -- while this one was withdrawn.
      perform public.raise_schedule_conflict(
        v_trip.blocked_range, v_trip.bus_id, null, null, p_trip_id
      );
  end;

  -- Withdrawing frees the coach (the constraint on `trips` excludes inactive
  -- rows), so it must free the crew too, for the same reason `cancel_trip`
  -- does. Reactivating does not put them back: the trip returns unstaffed and
  -- is rostered again deliberately, rather than quietly reclaiming people who
  -- may have been given other work in the meantime.
  if not p_active then
    update public.trip_assignments
       set status = 'CANCELLED'
     where trip_id = p_trip_id and status in ('ASSIGNED', 'ACTIVE');
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    case when p_active then 'TRIP_ACTIVATED' else 'TRIP_DEACTIVATED' end,
    'trip', p_trip_id,
    jsonb_build_object('tripNumber', v_trip.trip_number)
  );

  return jsonb_build_object('id', p_trip_id, 'isActive', p_active, 'changed', true);
end;
$$;

revoke all on function public.set_trip_active(uuid, boolean) from public, anon;
grant execute on function public.set_trip_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- assign_trip_crew
--
-- Same five checks as before. The clash is now asked of `trip_resource_conflict`
-- BEFORE anything is written, so a driver who finished another run a few
-- minutes ago is judged by when they actually finished. The exclusion
-- constraints stay as the backstop for two people rostering the same driver at
-- the same instant, which a read cannot prevent.
-- ---------------------------------------------------------------------------

create or replace function public.assign_trip_crew(
  p_trip_id uuid,
  p_driver_id uuid default null,
  p_assistant_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_trip public.trips%rowtype;
  v_driver public.drivers%rowtype;
  v_assistant public.assistants%rowtype;
  v_assignment_id uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_driver_id is null and p_assistant_id is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if not (public.is_admin() or public.can_manage_operator(v_trip.operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if v_trip.status in ('COMPLETED', 'CANCELLED', 'ARRIVED') then
    raise exception 'INVALID_TRIP_STATUS';
  end if;

  if p_driver_id is not null then
    select * into v_driver from public.drivers where id = p_driver_id;
    if not found or v_driver.operator_id <> v_trip.operator_id then
      raise exception 'FORBIDDEN';
    end if;

    if v_driver.availability_status <> 'AVAILABLE' then
      raise exception 'INACTIVE_RESOURCE';
    end if;

    if v_driver.user_id is not null and not exists (
      select 1 from public.profiles p
       where p.id = v_driver.user_id and p.account_status = 'ACTIVE'
    ) then
      raise exception 'ACCOUNT_DISABLED';
    end if;

    if v_driver.license_expiration_date is not null
       and v_driver.license_expiration_date < v_trip.departure_date then
      raise exception 'LICENSE_EXPIRED';
    end if;
  end if;

  if p_assistant_id is not null then
    select * into v_assistant from public.assistants where id = p_assistant_id;
    if not found or v_assistant.operator_id <> v_trip.operator_id then
      raise exception 'FORBIDDEN';
    end if;

    if v_assistant.availability_status <> 'AVAILABLE' then
      raise exception 'INACTIVE_RESOURCE';
    end if;

    if v_assistant.user_id is not null and not exists (
      select 1 from public.profiles p
       where p.id = v_assistant.user_id and p.account_status = 'ACTIVE'
    ) then
      raise exception 'ACCOUNT_DISABLED';
    end if;
  end if;

  -- The bus is not passed: it belongs to the trip, not the assignment, and its
  -- own constraint already held when the trip was written.
  if exists (
    select 1 from public.trip_resource_conflict(
      v_trip.blocked_range, null, p_driver_id, p_assistant_id, p_trip_id
    )
  ) then
    perform public.raise_schedule_conflict(
      v_trip.blocked_range, null, p_driver_id, p_assistant_id, p_trip_id
    );
  end if;

  -- Supersede rather than edit: `trip_assignments_one_live_idx` allows exactly
  -- one ASSIGNED/ACTIVE row per trip, and the old row is the record of who was
  -- meant to be on it before the swap.
  update public.trip_assignments
     set status = 'CANCELLED'
   where trip_id = p_trip_id and status in ('ASSIGNED', 'ACTIVE');

  begin
    insert into public.trip_assignments (trip_id, driver_id, assistant_id, status)
    values (p_trip_id, p_driver_id, p_assistant_id, 'ASSIGNED')
    returning id into v_assignment_id;
  exception
    when exclusion_violation then
      perform public.raise_schedule_conflict(
        v_trip.blocked_range, null, p_driver_id, p_assistant_id, p_trip_id
      );
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'TRIP_CREW_ASSIGNED', 'trip', p_trip_id,
    jsonb_build_object(
      'assignmentId', v_assignment_id,
      'driverId', p_driver_id,
      'assistantId', p_assistant_id
    )
  );

  return jsonb_build_object(
    'assignmentId', v_assignment_id,
    'tripId', p_trip_id,
    'driverId', p_driver_id,
    'assistantId', p_assistant_id
  );
end;
$$;

revoke all on function public.assign_trip_crew(uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_trip_crew(uuid, uuid, uuid) to authenticated;
