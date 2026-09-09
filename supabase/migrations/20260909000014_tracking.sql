-- Phase 8: live trip tracking.
--
-- Three things live here:
--   1. `bus_locations` — the GPS trail a driver publishes while on a trip.
--   2. Trip lifecycle RPCs, which finally record *actual* departure and arrival
--      against the scheduled ones. Phase 7's dashboard refused to show an
--      on-time rate because nothing recorded this; this is that data.
--   3. `trip_live_position` — the scoped read model the apps subscribe to.
--
-- ON THE WRITE PATH: a GPS ping every ten seconds through an Edge Function
-- would be a function invocation per bus per ten seconds for no gain — there is
-- no secret to hold and no cross-row invariant to maintain. The insert is a
-- direct table write guarded by RLS, which is what docs/security.md has said
-- since Phase 3: "RLS ties bus_locations inserts to the assigned driver".
--
-- Trip status is different and does NOT get a client write. Advancing a trip to
-- ON_TRIP or ARRIVED changes what a boarding scan means, so it goes through
-- SECURITY DEFINER functions with explicit authorisation, like seat reservation
-- and payment confirmation before it.

-- ---------------------------------------------------------------------------
-- Actual times
--
-- Nullable and never back-filled: a trip that has not departed has no actual
-- departure, and inventing `departure_date + departure_time` would make every
-- trip look perfectly punctual.
-- ---------------------------------------------------------------------------

alter table public.trips
  add column actual_departure_at timestamptz,
  add column actual_arrival_at timestamptz;

comment on column public.trips.actual_departure_at is
  'When the driver actually started the trip. Null until then — never defaulted to the schedule.';
comment on column public.trips.actual_arrival_at is
  'When the driver actually ended the trip. Null until then.';

-- ---------------------------------------------------------------------------
-- Authorisation helpers
--
-- SECURITY DEFINER so they can see `trip_assignments` and `bookings` rows the
-- caller cannot select directly. Both are `stable`, so a policy referencing
-- them is evaluated once per statement rather than once per row.
-- ---------------------------------------------------------------------------

/**
 * May the caller publish a position for this trip?
 *
 * Deliberately narrow: the *assigned* driver, on a *live* assignment, for a
 * trip that is actually running. A driver who finished yesterday's run cannot
 * keep pushing fixes, and a driver assigned to trip A cannot post to trip B.
 */
create or replace function public.can_publish_location(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trip_assignments ta
    join public.trips t on t.id = ta.trip_id
    where ta.trip_id = p_trip_id
      and ta.driver_id = public.current_driver_id()
      and ta.status = 'ACTIVE'
      and t.status in ('BOARDING', 'DEPARTED', 'ON_TRIP')
  );
$$;

/**
 * May the caller see where this bus is?
 *
 * A passenger qualifies only while holding a live booking on the trip — a
 * cancelled or refunded booking does not buy you a permanent tracker on a bus.
 * Crew and the owning operator qualify for their own trips. Note that `trips`
 * is world-readable for search, so this cannot be left to a caller-side filter.
 */
create or replace function public.can_track_trip(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or exists (
      select 1 from public.trips t
      where t.id = p_trip_id and t.operator_id = public.current_operator_id()
    )
    or exists (
      select 1 from public.trip_assignments ta
      where ta.trip_id = p_trip_id
        and ta.status in ('ASSIGNED', 'ACTIVE')
        and (
          ta.driver_id = public.current_driver_id()
          or ta.assistant_id = public.current_assistant_id()
        )
    )
    or exists (
      select 1 from public.bookings b
      where b.trip_id = p_trip_id
        and b.user_id = (select auth.uid())
        and b.status in ('CONFIRMED', 'CHECKED_IN', 'BOARDED', 'ON_TRIP', 'COMPLETED')
    );
$$;

grant execute on function public.can_publish_location(uuid) to authenticated;
grant execute on function public.can_track_trip(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- bus_locations
--
-- Append-only. Keeping the trail rather than one mutable row per bus means a
-- passenger who opens the app late still sees where the bus has been, and an
-- operator can review a journey afterwards.
--
-- `recorded_at` is the device clock at fix time; `created_at` is the server's.
-- Both are kept because they diverge: a phone that loses signal for a minute
-- flushes several fixes at once, and the ordering that matters is the device's.
-- ---------------------------------------------------------------------------

create table public.bus_locations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  -- Defaulted, not supplied by the client. There is no reason for a driver's
  -- phone to name its own driver record on every ping, and no reason to give it
  -- the chance to name someone else's. The insert policy checks it regardless.
  driver_id uuid not null default public.current_driver_id()
    references public.drivers (id) on delete cascade,
  latitude numeric(9, 6) not null,
  longitude numeric(9, 6) not null,
  -- Optional because a fix may not carry them: a stationary phone reports no
  -- heading, and a cold fix reports no speed.
  speed_kph numeric(6, 2),
  heading numeric(5, 2),
  accuracy_m numeric(7, 2),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint bus_locations_latitude_valid check (latitude between -90 and 90),
  constraint bus_locations_longitude_valid check (longitude between -180 and 180),
  constraint bus_locations_speed_sane check (speed_kph is null or speed_kph between 0 and 300),
  constraint bus_locations_heading_valid check (heading is null or heading between 0 and 360),
  constraint bus_locations_accuracy_positive check (accuracy_m is null or accuracy_m >= 0)
);

comment on table public.bus_locations is
  'Append-only GPS trail published by the assigned driver while a trip is live.';

-- The only query that matters: newest fixes for one trip.
create index bus_locations_trip_recorded_idx
  on public.bus_locations (trip_id, recorded_at desc);
create index bus_locations_driver_idx on public.bus_locations (driver_id);


-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Insert only, and only for the assigned driver. No update and no delete for
-- any client: the trail is evidence of where a bus went, and a driver who can
-- rewrite it can rewrite a late departure into an on-time one.
-- ---------------------------------------------------------------------------

alter table public.bus_locations enable row level security;

create policy "Trip participants read bus locations"
  on public.bus_locations for select to authenticated
  using (public.can_track_trip(trip_id));

create policy "Assigned drivers publish their own position"
  on public.bus_locations for insert to authenticated
  with check (
    driver_id = public.current_driver_id()
    and public.can_publish_location(trip_id)
  );

revoke update, delete on public.bus_locations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- trip_live_position
--
-- Latest fix per trip, with the schedule and route endpoints the tracking
-- screen needs, so opening the map is one round trip rather than four.
--
-- The scoping is INSIDE the view, exactly as with the Phase 7 operator views.
-- That was not paranoia: a caller-side filter leaked a rival operator's data
-- twice in Phase 7. `security_invoker` keeps the base-table RLS in force too,
-- so this is belt and braces rather than a substitute for it.
-- ---------------------------------------------------------------------------

create view public.trip_live_position with (security_invoker = true) as
select
  t.id                     as trip_id,
  t.trip_number,
  t.status                 as trip_status,
  t.departure_date,
  t.departure_time,
  t.arrival_time,
  t.actual_departure_at,
  t.actual_arrival_at,
  b.bus_number,
  b.plate_number,
  o.code                   as origin_code,
  o.name                   as origin_name,
  o.latitude               as origin_latitude,
  o.longitude              as origin_longitude,
  d.code                   as destination_code,
  d.name                   as destination_name,
  d.latitude               as destination_latitude,
  d.longitude              as destination_longitude,
  loc.latitude,
  loc.longitude,
  loc.speed_kph,
  loc.heading,
  loc.accuracy_m,
  loc.recorded_at
from public.trips t
join public.buses b on b.id = t.bus_id
join public.routes r on r.id = t.route_id
join public.terminals o on o.id = r.origin_terminal_id
join public.terminals d on d.id = r.destination_terminal_id
-- One row, the newest, or none at all if the driver has not started publishing.
left join lateral (
  select bl.latitude, bl.longitude, bl.speed_kph, bl.heading, bl.accuracy_m, bl.recorded_at
  from public.bus_locations bl
  where bl.trip_id = t.id
  order by bl.recorded_at desc
  limit 1
) loc on true
where public.can_track_trip(t.id);

comment on view public.trip_live_position is
  'Newest position for one trip plus its schedule and route endpoints. Scoped inside the view because public.trips is world-readable for search.';

grant select on public.trip_live_position to authenticated;

-- ---------------------------------------------------------------------------
-- Trip lifecycle
--
-- SECURITY DEFINER with explicit checks, because trip status is not the
-- client's to decide. Each transition is guarded so a double tap or a retry
-- after a dropped connection cannot rewrite a timestamp that is already set.
-- ---------------------------------------------------------------------------

/**
 * Who may drive this trip's status forward: the assigned driver, or the owning
 * operator (a dispatcher correcting a driver whose phone died).
 */
create or replace function public.can_manage_trip_status(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or exists (
      select 1 from public.trips t
      where t.id = p_trip_id
        and t.operator_id = public.current_operator_id()
        and public.current_profile_role() = 'OPERATOR'
    )
    or exists (
      select 1 from public.trip_assignments ta
      where ta.trip_id = p_trip_id
        and ta.driver_id = public.current_driver_id()
        and ta.status in ('ASSIGNED', 'ACTIVE')
    );
$$;

grant execute on function public.can_manage_trip_status(uuid) to authenticated;

/**
 * Start the trip: SCHEDULED or BOARDING → DEPARTED, stamping the actual
 * departure and activating the crew assignment so the driver may publish GPS.
 *
 * Idempotent by precondition rather than by upsert: calling it twice returns
 * the trip already departed with its original timestamp, so a retry after a
 * lost response does not move the time a driver will later be judged against.
 */
create or replace function public.start_trip(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips;
begin
  if not public.can_manage_trip_status(p_trip_id) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_trip.status in ('DEPARTED', 'ON_TRIP') then
    return jsonb_build_object(
      'tripId', v_trip.id,
      'status', v_trip.status,
      'actualDepartureAt', v_trip.actual_departure_at,
      'alreadyStarted', true
    );
  end if;

  if v_trip.status not in ('SCHEDULED', 'BOARDING') then
    raise exception 'INVALID_TRIP_STATUS';
  end if;

  update public.trips
     set status = 'DEPARTED',
         actual_departure_at = now()
   where id = p_trip_id
  returning * into v_trip;

  -- The driver cannot publish a position on an ASSIGNED assignment, only an
  -- ACTIVE one, so starting the trip is what opens the write path.
  update public.trip_assignments
     set status = 'ACTIVE'
   where trip_id = p_trip_id and status = 'ASSIGNED';

  -- Passengers who boarded are now travelling. CHECKED_IN is left alone: they
  -- passed a gate but never boarded, and marking them ON_TRIP would say they
  -- are on a bus that left without them.
  update public.bookings
     set status = 'ON_TRIP'
   where trip_id = p_trip_id and status = 'BOARDED';

  return jsonb_build_object(
    'tripId', v_trip.id,
    'status', v_trip.status,
    'actualDepartureAt', v_trip.actual_departure_at,
    'alreadyStarted', false
  );
end;
$$;

/**
 * Mark the trip as boarding: SCHEDULED → BOARDING. Separate from `start_trip`
 * so the operator dashboard's "Boarding" count means something, and so the
 * driver can begin scanning tickets before the bus moves.
 */
create or replace function public.set_trip_boarding(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips;
begin
  if not public.can_manage_trip_status(p_trip_id) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_trip.status = 'BOARDING' then
    return jsonb_build_object('tripId', v_trip.id, 'status', v_trip.status, 'changed', false);
  end if;

  if v_trip.status <> 'SCHEDULED' then
    raise exception 'INVALID_TRIP_STATUS';
  end if;

  update public.trips set status = 'BOARDING' where id = p_trip_id returning * into v_trip;

  return jsonb_build_object('tripId', v_trip.id, 'status', v_trip.status, 'changed', true);
end;
$$;

/**
 * End the trip: DEPARTED or ON_TRIP → ARRIVED, stamping the actual arrival and
 * closing the crew assignment, which also closes the GPS write path.
 *
 * Bookings become COMPLETED only if the passenger actually boarded. Someone who
 * paid and never showed up is left CONFIRMED for Phase 9/10 to deal with —
 * silently completing their booking would credit loyalty points for a trip they
 * did not take.
 */
create or replace function public.end_trip(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips;
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
      'alreadyEnded', true
    );
  end if;

  if v_trip.status not in ('DEPARTED', 'ON_TRIP') then
    raise exception 'INVALID_TRIP_STATUS';
  end if;

  update public.trips
     set status = 'ARRIVED',
         actual_arrival_at = now()
   where id = p_trip_id
  returning * into v_trip;

  update public.trip_assignments
     set status = 'COMPLETED'
   where trip_id = p_trip_id and status in ('ASSIGNED', 'ACTIVE');

  update public.bookings
     set status = 'COMPLETED'
   where trip_id = p_trip_id and status in ('BOARDED', 'ON_TRIP');

  return jsonb_build_object(
    'tripId', v_trip.id,
    'status', v_trip.status,
    'actualArrivalAt', v_trip.actual_arrival_at,
    'alreadyEnded', false
  );
end;
$$;

revoke all on function public.start_trip(uuid) from public;
revoke all on function public.set_trip_boarding(uuid) from public;
revoke all on function public.end_trip(uuid) from public;
grant execute on function public.start_trip(uuid) to authenticated;
grant execute on function public.set_trip_boarding(uuid) to authenticated;
grant execute on function public.end_trip(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The driver's own duty board
--
-- A driver needs their assigned trips, and `trip_assignments` plus `trips`
-- would not give them the terminal names without also opening up joins they do
-- not otherwise need. Scoped to the caller's own driver record inside the view.
-- ---------------------------------------------------------------------------

create view public.driver_assignments with (security_invoker = true) as
select
  ta.id                    as assignment_id,
  ta.status                as assignment_status,
  t.id                     as trip_id,
  t.trip_number,
  t.status                 as trip_status,
  t.departure_date,
  t.departure_time,
  t.arrival_time,
  t.actual_departure_at,
  t.actual_arrival_at,
  b.bus_number,
  b.plate_number,
  b.capacity,
  o.code                   as origin_code,
  o.name                   as origin_name,
  d.code                   as destination_code,
  d.name                   as destination_name,
  -- Same positive status list as `operator_trip_overview`, so the driver's
  -- board and the operator's dashboard cannot disagree about how many people
  -- are on the bus.
  (
    select count(*) from public.bookings bk
      join public.booking_passengers bp on bp.booking_id = bk.id
    where bk.trip_id = t.id
      and bk.status in ('CONFIRMED', 'CHECKED_IN', 'BOARDED', 'ON_TRIP', 'COMPLETED')
  )::int                   as passenger_count,
  (
    select count(*) from public.bookings bk
      join public.booking_passengers bp on bp.booking_id = bk.id
    where bk.trip_id = t.id and bk.status in ('BOARDED', 'ON_TRIP', 'COMPLETED')
  )::int                   as boarded_count
from public.trip_assignments ta
join public.trips t on t.id = ta.trip_id
join public.buses b on b.id = t.bus_id
join public.routes r on r.id = t.route_id
join public.terminals o on o.id = r.origin_terminal_id
join public.terminals d on d.id = r.destination_terminal_id
where ta.driver_id = public.current_driver_id()
   or ta.assistant_id = public.current_assistant_id();

comment on view public.driver_assignments is
  'The signed-in crew member''s own trip assignments. Scoped inside the view.';

grant select on public.driver_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
--
-- Passengers subscribe to `bus_locations` for their trip and to `trips` for
-- status changes. Realtime respects RLS, so a passenger without a booking on
-- the trip receives nothing — the filter is not client-side.
--
-- `replica identity full` on trips so a status UPDATE carries the whole row;
-- without it subscribers get only the primary key and have to re-query.
-- bus_locations is insert-only, so the default identity is enough.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.bus_locations;
alter publication supabase_realtime add table public.trips;
alter table public.trips replica identity full;
