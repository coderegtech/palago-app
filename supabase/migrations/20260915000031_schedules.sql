-- Bus and crew scheduling: a trip lifecycle, and conflicts the database refuses
-- rather than the form remembering to check.
--
-- Until now a trip was a plain INSERT under the column grants from
-- `20260911000024_staff_write_scope.sql`. Nothing stopped the same coach — or
-- the same driver — being put on two departures that overlap. A check inside
-- the insert function would be an improvement and still wrong: two operators
-- clicking Save at the same moment would both read "free" and both write.
--
-- So the rule is a constraint. Each trip carries the window its bus is spoken
-- for, `EXCLUDE USING gist` makes two overlapping windows for one bus
-- impossible under any concurrency, and the same treatment on
-- `trip_assignments` does it for the driver and the conductor.
--
-- The window is the journey plus a turnaround buffer — a coach arriving at
-- 14:00 is not ready to leave again at 14:00. The buffer is configuration
-- (default 30 minutes), which is why `blocked_range` is a trigger-maintained
-- column and not a generated one: a generated column must be IMMUTABLE and so
-- cannot read a setting.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- The buffer, and reading settings safely
--
-- `app_settings` holds the push webhook secret and has no client read policy at
-- all. `public_setting` opens exactly the keys that are not secrets, so the
-- operator console can say "this bus is free from 14:30" without the table
-- being readable.
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value) values ('trip_turnaround_minutes', '30')
on conflict (key) do nothing;

create or replace function public.turnaround_minutes()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(regexp_replace(value, '\D', '', 'g'), '')::integer
       from public.app_settings where key = 'trip_turnaround_minutes'),
    30
  );
$$;

comment on function public.turnaround_minutes is
  'Minutes a bus and its crew stay spoken for after a trip arrives. Configuration, not schema.';

create or replace function public.public_setting(p_key text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value text;
begin
  -- An allowlist, not a denylist. A new secret added to app_settings must not
  -- become readable because somebody forgot to exclude it here.
  if p_key not in ('trip_turnaround_minutes') then
    raise exception 'FORBIDDEN';
  end if;

  select value into v_value from public.app_settings where key = p_key;
  return v_value;
end;
$$;

revoke all on function public.turnaround_minutes() from public, anon;
revoke all on function public.public_setting(text) from public, anon;
grant execute on function public.turnaround_minutes() to authenticated;
grant execute on function public.public_setting(text) to authenticated;

-- ---------------------------------------------------------------------------
-- When a trip actually occupies its bus
--
-- IMMUTABLE, and `timestamp` rather than `timestamptz`: Palawan is one zone,
-- and timestamptz arithmetic depends on the session's TimeZone, which would
-- make two clients disagree about whether two trips overlap.
--
-- An arrival time at or before the departure time means the next day. An
-- overnight RoRo sailing leaving at 20:00 and arriving 06:00 is ten hours, not
-- minus fourteen — and getting that backwards would make every overnight
-- departure look free.
-- ---------------------------------------------------------------------------

create or replace function public.trip_arrival_timestamp(
  p_date date,
  p_departure time,
  p_arrival time
)
returns timestamp
language sql
immutable
as $$
  select (
    p_date
    + p_arrival
    + case when p_arrival <= p_departure then interval '1 day' else interval '0 day' end
  )::timestamp;
$$;

comment on function public.trip_arrival_timestamp is
  'Arrival as a timestamp, rolling to the next day when the arrival time is at or before the departure time.';

alter table public.trips
  add column departure_at timestamp,
  add column arrival_at timestamp,
  -- [departure, arrival + turnaround). Half-open, so a trip may depart at the
  -- exact instant the previous one's buffer ends.
  add column blocked_range tsrange,
  add column is_active boolean not null default true,
  add column cancelled_reason text,
  add column cancelled_by uuid references auth.users (id) on delete set null,
  add column completed_by uuid references auth.users (id) on delete set null;

comment on column public.trips.blocked_range is
  'The window this trip holds its bus for, journey plus turnaround. Maintained by trigger; the exclusion constraint below reads it.';
comment on column public.trips.is_active is
  'False for a schedule withdrawn from sale. Not the same as CANCELLED, which is a trip that was going to run and will not.';

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
  new.blocked_range := tsrange(
    new.departure_at,
    new.arrival_at + make_interval(mins => public.turnaround_minutes()),
    '[)'
  );
  return new;
end;
$$;

create trigger trips_stamp_schedule
  before insert or update of departure_date, departure_time, arrival_time
  on public.trips
  for each row execute function public.stamp_trip_schedule();

-- Backfill through the same helper the trigger uses, so existing rows and new
-- ones cannot disagree. `trips_set_updated_at` is held off: this is a schema
-- change, not somebody editing the schedule.
alter table public.trips disable trigger trips_set_updated_at;

update public.trips
   set departure_at = (departure_date + departure_time)::timestamp,
       arrival_at = public.trip_arrival_timestamp(departure_date, departure_time, arrival_time),
       blocked_range = tsrange(
         (departure_date + departure_time)::timestamp,
         public.trip_arrival_timestamp(departure_date, departure_time, arrival_time)
           + make_interval(mins => public.turnaround_minutes()),
         '[)'
       );

alter table public.trips enable trigger trips_set_updated_at;

alter table public.trips
  alter column departure_at set not null,
  alter column arrival_at set not null,
  alter column blocked_range set not null;

-- ---------------------------------------------------------------------------
-- One bus, one place at a time
--
-- A cancelled or withdrawn trip releases its coach — that is the whole point of
-- cancelling one — so neither is in the constraint.
-- ---------------------------------------------------------------------------

-- Before the constraint: does the data already break it?
--
-- On a fresh database it cannot. On one with history it can, and Postgres
-- reports that as a bare `23P01` naming two UUIDs and two timestamp ranges,
-- which tells whoever is running the migration almost nothing. This says which
-- departures clash and what to do about it.
--
-- It refuses rather than resolving. Fixing a bus overlap means cancelling or
-- moving a trip; cancelling one cancels every booking on it, releases the
-- seats and tells the passengers. That is a decision with people attached, and
-- a migration is not the place to make it.
do $preflight$
declare
  v_clashes text;
begin
  select string_agg(
           format('%s (%s–%s) and %s (%s–%s), both on coach %s',
                  a.trip_number, a.departure_at, a.arrival_at,
                  b.trip_number, b.departure_at, b.arrival_at,
                  bus.bus_number),
           chr(10) || '  '
           order by a.departure_at
         )
    into v_clashes
    from public.trips a
    join public.trips b on b.bus_id = a.bus_id and b.id > a.id
    join public.buses bus on bus.id = a.bus_id
   where a.status <> 'CANCELLED' and a.is_active
     and b.status <> 'CANCELLED' and b.is_active
     and a.blocked_range && b.blocked_range;

  if v_clashes is not null then
    raise exception 'SCHEDULE_CONFLICT_IN_EXISTING_DATA'
      using
        detail = 'These departures already share a coach at the same time:'
                 || chr(10) || '  ' || v_clashes,
        hint = 'Cancel or re-time one of each pair, then run the migration again. '
               || 'Note the turnaround buffer: a coach is spoken for '
               || public.turnaround_minutes()::text
               || ' minutes after it arrives, so two trips can clash even when their '
               || 'journeys do not overlap.';
  end if;
end
$preflight$;

alter table public.trips
  add constraint trips_bus_no_overlap
  exclude using gist (bus_id with =, blocked_range with &&)
  where (status <> 'CANCELLED' and is_active);

create index trips_blocked_range_idx on public.trips using gist (bus_id, blocked_range);

-- ---------------------------------------------------------------------------
-- One driver, one bus
--
-- `trip_assignments` has no times of its own, so it carries a copy of its
-- trip's window. Denormalised on purpose: an exclusion constraint can only read
-- columns of its own table, and the alternative — checking inside the assign
-- function — is the read-then-write race this migration exists to avoid.
--
-- The copy is kept honest by two triggers: one stamps it on write, and one
-- re-stamps every assignment when the trip's own window moves.
-- ---------------------------------------------------------------------------

alter table public.trip_assignments add column blocked_range tsrange;

create or replace function public.stamp_assignment_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select t.blocked_range into new.blocked_range
    from public.trips t where t.id = new.trip_id;

  if new.blocked_range is null then
    raise exception 'NOT_FOUND';
  end if;

  return new;
end;
$$;

create trigger trip_assignments_stamp_window
  before insert or update of trip_id
  on public.trip_assignments
  for each row execute function public.stamp_assignment_window();

create or replace function public.restamp_assignment_windows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.blocked_range is distinct from old.blocked_range then
    update public.trip_assignments
       set blocked_range = new.blocked_range
     where trip_id = new.id
       and blocked_range is distinct from new.blocked_range;
  end if;
  return null;
end;
$$;

create trigger trips_restamp_assignments
  after update on public.trips
  for each row execute function public.restamp_assignment_windows();

update public.trip_assignments ta
   set blocked_range = t.blocked_range
  from public.trips t
 where t.id = ta.trip_id;

alter table public.trip_assignments alter column blocked_range set not null;

-- Crew already double-booked, stood down before the constraint goes on.
--
-- Unlike a bus overlap this IS resolved here, because the two are not
-- comparable. Cancelling a trip cancels bookings and tells passengers; standing
-- down a crew assignment moves nobody's money and nobody's seat. It is also
-- recoverable in one action, and visible without looking for it — the schedule
-- screen shows an uncrewed departure as "No driver" in red.
--
-- Nothing is deleted: the row is set CANCELLED, which is exactly what
-- `assign_trip_crew` does when it supersedes one, and every change is written
-- to `audit_logs` so it can be read back.
--
-- Who loses, in order:
--   1. an ASSIGNED row loses to an ACTIVE one — you cannot un-crew a bus that
--      is already moving;
--   2. otherwise the later departure loses, because the driver is physically
--      on the earlier one first;
--   3. ties go to the lower id, so two runs of this migration on the same data
--      make the same choice.
--
-- The loop cancels one row per pass and the candidate set strictly shrinks, so
-- a chain of three overlapping assignments resolves down to one.
do $preflight$
declare
  v_loser uuid;
  v_kept text;
  v_dropped text;
  v_count integer := 0;
begin
  loop
    select loser.id,
           lt.trip_number,
           wt.trip_number
      into v_loser, v_dropped, v_kept
      from public.trip_assignments loser
      join public.trips lt on lt.id = loser.trip_id
      join public.trip_assignments winner on winner.id <> loser.id
      join public.trips wt on wt.id = winner.trip_id
     where loser.status in ('ASSIGNED', 'ACTIVE')
       and winner.status in ('ASSIGNED', 'ACTIVE')
       and loser.blocked_range && winner.blocked_range
       and (
         (loser.driver_id is not null and loser.driver_id = winner.driver_id)
         or (loser.assistant_id is not null and loser.assistant_id = winner.assistant_id)
       )
       and (
         (winner.status = 'ACTIVE' and loser.status = 'ASSIGNED')
         or (
           winner.status = loser.status
           and (wt.departure_at, winner.id) < (lt.departure_at, loser.id)
         )
       )
     limit 1;

    exit when v_loser is null;

    update public.trip_assignments set status = 'CANCELLED' where id = v_loser;

    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
    values (
      null, 'TRIP_CREW_UNASSIGNED', 'trip_assignment', v_loser,
      jsonb_build_object(
        'reason', 'Stood down by migration 20260915000031: the same person was '
                  || 'rostered on two overlapping departures, which the new '
                  || 'exclusion constraints make impossible.',
        'droppedFrom', v_dropped,
        'keptOn', v_kept
      )
    );

    v_count := v_count + 1;
    v_loser := null;
  end loop;

  if v_count > 0 then
    raise notice
      'Stood down % crew assignment(s) that had one person on two overlapping '
      'departures. Those trips now show as uncrewed and need rostering again; '
      'each change is in audit_logs as TRIP_CREW_UNASSIGNED.', v_count;
  end if;
end
$preflight$;

alter table public.trip_assignments
  add constraint trip_assignments_driver_no_overlap
  exclude using gist (driver_id with =, blocked_range with &&)
  where (status in ('ASSIGNED', 'ACTIVE') and driver_id is not null);

alter table public.trip_assignments
  add constraint trip_assignments_assistant_no_overlap
  exclude using gist (assistant_id with =, blocked_range with &&)
  where (status in ('ASSIGNED', 'ACTIVE') and assistant_id is not null);

-- ---------------------------------------------------------------------------
-- set_turnaround_minutes
--
-- Changing the buffer changes what counts as a clash, so every future trip is
-- re-stamped. If widening it would put two coaches on top of each other the
-- exclusion constraint refuses the whole change — which is the right answer:
-- silently keeping the old window for some trips and the new one for others
-- would be worse than saying no.
--
-- Past trips are left alone. Re-stamping a journey that already happened could
-- only fail, and would tell nobody anything.
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
       set blocked_range = tsrange(
             departure_at, arrival_at + make_interval(mins => p_minutes), '[)'
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
         and tsrange(a.departure_at, a.arrival_at + make_interval(mins => p_minutes), '[)')
             && tsrange(b.departure_at, b.arrival_at + make_interval(mins => p_minutes), '[)')
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
-- Trips stop being writable from a client
--
-- `20260911000024` granted INSERT and UPDATE on specific columns so an operator
-- could add a departure. Those grants are withdrawn: a trip now arrives through
-- `create_trip`, which checks that the bus, route and operator are all active
-- and all belong to each other before the exclusion constraint gets a say.
-- ---------------------------------------------------------------------------

revoke insert, update on public.trips from anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_trip
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
  v_clash text;
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
      -- Name the trip it clashes with. "That bus is busy" sends somebody
      -- hunting through a month of departures.
      select t.trip_number into v_clash
        from public.trips t
       where t.bus_id = p_bus_id
         and t.status <> 'CANCELLED'
         and t.is_active
         and t.blocked_range && tsrange(
               (p_departure_date + p_departure_time)::timestamp,
               public.trip_arrival_timestamp(p_departure_date, p_departure_time, p_arrival_time)
                 + make_interval(mins => public.turnaround_minutes()),
               '[)'
             )
       limit 1;
      raise exception 'SCHEDULE_CONFLICT' using detail = coalesce(v_clash, '');
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
-- Only while the trip has not started. Moving a departure that is already
-- boarding or under way would rewrite the schedule a busload of people are
-- standing in front of, and `trips.status` is not writable here in any case.
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
  v_clash text;
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
      select t.trip_number into v_clash
        from public.trips t
       where t.bus_id = p_bus_id
         and t.id <> p_trip_id
         and t.status <> 'CANCELLED'
         and t.is_active
         and t.blocked_range && tsrange(
               (p_departure_date + p_departure_time)::timestamp,
               public.trip_arrival_timestamp(p_departure_date, p_departure_time, p_arrival_time)
                 + make_interval(mins => public.turnaround_minutes()),
               '[)'
             )
       limit 1;
      raise exception 'SCHEDULE_CONFLICT' using detail = coalesce(v_clash, '');
    when unique_violation then
      raise exception 'VALIDATION_ERROR';
  end;

  -- Moving the trip moves its crew's window too (the restamp trigger), so the
  -- new times can also clash for the driver rather than the bus.
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
-- cancel_trip
--
-- Never a delete. The trip stays, with a reason and the person who called it,
-- because tickets, payments and boarding records all point at it and a
-- passenger asking "what happened to my bus" deserves an answer.
--
-- Live bookings are cancelled with it, their seats released and their owners
-- told. Refunds are not automatic: the money moved through the payment
-- functions and goes back the same way, deliberately as a separate decision.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_trip(p_trip_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_trip public.trips%rowtype;
  v_bookings integer := 0;
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

  if v_trip.status = 'CANCELLED' then
    return jsonb_build_object('id', p_trip_id, 'status', 'CANCELLED', 'changed', false);
  end if;

  if v_trip.status in ('COMPLETED', 'ARRIVED') then
    raise exception 'INVALID_TRIP_STATUS';
  end if;

  update public.trips
     set status = 'CANCELLED',
         cancelled_reason = nullif(trim(coalesce(p_reason, '')), ''),
         cancelled_by = v_actor
   where id = p_trip_id;

  -- Release the crew as well as the coach. The exclusion constraints on
  -- `trip_assignments` read the assignment's own status, not its trip's, so an
  -- assignment left ASSIGNED on a cancelled trip goes on blocking that driver
  -- and that conductor for the window of a journey nobody is making. The row
  -- is cancelled, not deleted: who was rostered for it is still on the record.
  update public.trip_assignments
     set status = 'CANCELLED'
   where trip_id = p_trip_id and status in ('ASSIGNED', 'ACTIVE');

  with cancelled as (
    update public.bookings
       set status = 'CANCELLED', cancelled_at = now()
     where trip_id = p_trip_id
       and status in ('PENDING', 'PAYMENT_PENDING', 'CONFIRMED', 'CHECKED_IN')
    returning id, user_id, booking_reference
  ),
  released_seats as (
    update public.trip_seats ts
       set status = 'AVAILABLE', booking_id = null, held_by = null,
           held_until = null, confirmed_at = null
     where ts.trip_id = p_trip_id
       and ts.booking_id in (select id from cancelled)
    returning ts.id
  ),
  cleared_passengers as (
    update public.booking_passengers bp
       set seat_id = null
     where bp.booking_id in (select id from cancelled)
    returning bp.id
  ),
  told as (
    insert into public.notifications (user_id, type, title, message, data)
    select
      c.user_id, 'TRIP_CANCELLED', 'Trip cancelled',
      'Your trip ' || v_trip.trip_number || ' has been cancelled. Booking '
        || c.booking_reference || '.',
      jsonb_build_object('bookingId', c.id, 'tripId', p_trip_id)
    from cancelled c
    -- A counter walk-in has no account to notify.
    where c.user_id is not null
    returning 1
  )
  select count(*) into v_bookings from cancelled;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'TRIP_CANCELLED', 'trip', p_trip_id,
    jsonb_build_object(
      'tripNumber', v_trip.trip_number,
      'reason', p_reason,
      'bookingsCancelled', v_bookings
    )
  );

  return jsonb_build_object(
    'id', p_trip_id, 'status', 'CANCELLED', 'changed', true, 'bookingsCancelled', v_bookings
  );
end;
$$;

revoke all on function public.cancel_trip(uuid, text) from public, anon;
grant execute on function public.cancel_trip(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- set_trip_active
--
-- Withdrawing a schedule from sale without saying the trip was cancelled —
-- a departure that is not running this season, say. Refused while anyone holds
-- a seat on it, because the honest word for that is "cancelled".
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
      raise exception 'SCHEDULE_CONFLICT';
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
-- The five checks the brief asks for, in one place, server-side:
--
--   1. the account is ACTIVE — when there is one. A crew record with no login
--      is somebody on the roster who does not use the app; they have always
--      been assignable and still are.
--   2. availability is AVAILABLE.
--   3. the crew member belongs to this trip's operator.
--   4. no clash — the exclusion constraint, not a check-then-write.
--   5. "qualified", read concretely: a driver whose licence is known to expire
--      before the departure date is refused. A licence with no recorded expiry
--      is not evidence of anything, so it does not block.
--
-- Replacing the crew on a trip supersedes the live assignment rather than
-- editing it, so the history of who was on which bus survives.
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
  v_clash text;
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
      select t.trip_number into v_clash
        from public.trip_assignments ta
        join public.trips t on t.id = ta.trip_id
       where ta.status in ('ASSIGNED', 'ACTIVE')
         and ta.trip_id <> p_trip_id
         and ta.blocked_range && v_trip.blocked_range
         and (
           (p_driver_id is not null and ta.driver_id = p_driver_id)
           or (p_assistant_id is not null and ta.assistant_id = p_assistant_id)
         )
       limit 1;
      raise exception 'SCHEDULE_CONFLICT' using detail = coalesce(v_clash, '');
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

create or replace function public.unassign_trip_crew(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_trip public.trips%rowtype;
  v_count integer;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_trip from public.trips where id = p_trip_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if not (public.is_admin() or public.can_manage_operator(v_trip.operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  -- Not while the bus is moving: `can_publish_location`, `can_scan_trip` and
  -- `can_manage_sos` all read this, so pulling it mid-journey would cut the
  -- driver off from the trip they are on.
  if v_trip.status in ('DEPARTED', 'ON_TRIP') then
    raise exception 'INVALID_TRIP_STATUS';
  end if;

  update public.trip_assignments
     set status = 'CANCELLED'
   where trip_id = p_trip_id and status in ('ASSIGNED', 'ACTIVE');
  get diagnostics v_count = row_count;

  if v_count > 0 then
    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
    values (
      v_actor, 'TRIP_CREW_UNASSIGNED', 'trip', p_trip_id,
      jsonb_build_object('tripNumber', v_trip.trip_number)
    );
  end if;

  return jsonb_build_object('tripId', p_trip_id, 'cleared', v_count);
end;
$$;

revoke all on function public.unassign_trip_crew(uuid) from public, anon;
grant execute on function public.unassign_trip_crew(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- end_trip, patched to record who ended it
--
-- The brief asks every administrative action to name its actor. `end_trip`
-- checks that the caller was this trip's crew and then forgets who they were.
-- One line, at one anchor, on the live definition: everything after it
-- (completing the bookings, awarding loyalty, closing the crew assignment) is
-- untouched.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.end_trip(p_trip_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_trip public.trips;
  v_booking record;
  v_awarded integer := 0;
  v_points integer;
begin
  if not public.can_manage_trip_status(p_trip_id) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_trip.status in ('ARRIVED', 'COMPLETED') then
    return jsonb_build_object(
      'tripId', v_trip.id,
      'status', v_trip.status,
      'actualArrivalAt', v_trip.actual_arrival_at,
      'alreadyEnded', true,
      -- Zero, not null: a retry awards nothing because the first call already
      -- did, and `award_loyalty_for_booking` is exactly-once by index.
      'pointsAwarded', 0
    );
  end if;

  if v_trip.status not in ('DEPARTED', 'ON_TRIP') then
    raise exception 'INVALID_TRIP_STATUS';
  end if;

  update public.trips
     set status = 'ARRIVED',
         actual_arrival_at = now(),
         -- `end_trip` has no user variable of its own: it authorises through
         -- `can_manage_trip_status(p_trip_id)`, which asks the question without
         -- naming the asker.
         completed_by = (select auth.uid())
   where id = p_trip_id
  returning * into v_trip;

  update public.trip_assignments
     set status = 'COMPLETED'
   where trip_id = p_trip_id and status in ('ASSIGNED', 'ACTIVE');

  update public.bookings
     set status = 'COMPLETED'
   where trip_id = p_trip_id and status in ('BOARDED', 'ON_TRIP');

  -- Phase 10: points for the passengers who actually travelled. Only bookings
  -- that just became COMPLETED are eligible, and the unique index makes a
  -- second call a no-op rather than a double award.
  for v_booking in
    select id from public.bookings
     where trip_id = p_trip_id and status = 'COMPLETED'
  loop
    v_points := public.award_loyalty_for_booking(v_booking.id);
    v_awarded := v_awarded + v_points;
  end loop;

  return jsonb_build_object(
    'tripId', v_trip.id,
    'status', v_trip.status,
    'actualArrivalAt', v_trip.actual_arrival_at,
    'alreadyEnded', false,
    'pointsAwarded', v_awarded
  );
end;
$function$;

revoke all on function public.end_trip(uuid) from public, anon;
grant execute on function public.end_trip(uuid) to authenticated;
