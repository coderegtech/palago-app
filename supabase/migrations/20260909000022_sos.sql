-- Phase 11: SOS / emergency assistance.
--
-- A passenger in trouble raises an alert that captures where they are and who
-- they are travelling with. The operator running that trip (and its crew, and
-- an admin) sees it and drives it through acknowledge → responding → resolved.
-- The passenger can cancel their own false alarm until a responder is moving.
--
-- Same shape as every other privileged flow in PalaGo:
--   * status is the server's to decide — no client UPDATE, and creation goes
--     through `trigger_sos`, not a direct INSERT, so coordinates are validated,
--     the trip is resolved from the caller's own booking, and the audit and
--     notification rows are written in the same transaction;
--   * one open incident per passenger — a panicking double-tap returns the
--     existing alert rather than raising a second one;
--   * errors are raised with the message set to an exact code from
--     src/constants/errors.ts (`mapRpcError` turns them back into an AppError).

create type public.sos_status as enum (
  'ACTIVE', 'ACKNOWLEDGED', 'RESPONDING', 'RESOLVED', 'CANCELLED'
);

-- ---------------------------------------------------------------------------
-- sos_incidents
--
-- `trip_id` is nullable on purpose: an emergency before boarding is still an
-- emergency, and blocking the alert because the booking is not `ON_TRIP` yet
-- would be the wrong call. A trip-less incident is visible to admins only,
-- because there is no operator to scope it to.
-- ---------------------------------------------------------------------------

create table public.sos_incidents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete set null,
  trip_id uuid references public.trips (id) on delete set null,
  -- Where the passenger was when they raised it. Same precision and bounds as
  -- bus_locations / terminals — a fix, not a freeform number.
  latitude numeric(9, 6) not null,
  longitude numeric(9, 6) not null,
  status public.sos_status not null default 'ACTIVE',
  -- Responder's closing note.
  note text,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users (id) on delete set null,
  responding_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint sos_incidents_latitude_valid check (latitude between -90 and 90),
  constraint sos_incidents_longitude_valid check (longitude between -180 and 180),
  -- The lifecycle timestamps a terminal status implies are always present,
  -- because the functions below set them. Checked so a future bug cannot
  -- persist a RESOLVED incident with no resolution time.
  constraint sos_incidents_acknowledged_time
    check (acknowledged_at is not null or status in ('ACTIVE', 'CANCELLED')),
  constraint sos_incidents_resolved_time
    check ((status = 'RESOLVED') = (resolved_at is not null))
);

comment on table public.sos_incidents is
  'Emergency assistance alerts raised by passengers. Status is server-controlled; created only through trigger_sos.';
comment on column public.sos_incidents.trip_id is
  'The trip the passenger is on, resolved server-side. Null if they raised the alert before boarding.';

create index sos_incidents_user_idx on public.sos_incidents (user_id, created_at desc);
create index sos_incidents_trip_idx on public.sos_incidents (trip_id);
create index sos_incidents_created_idx on public.sos_incidents (created_at desc);
-- The operator console's query: alerts that still need attention.
create index sos_incidents_open_idx on public.sos_incidents (created_at desc)
  where status in ('ACTIVE', 'ACKNOWLEDGED', 'RESPONDING');

-- One live emergency per passenger. A second `trigger_sos` while an alert is
-- still open is a double-tap, not a new incident — the function catches the
-- violation and returns the open one.
create unique index sos_incidents_one_open_per_user_idx
  on public.sos_incidents (user_id)
  where status in ('ACTIVE', 'ACKNOWLEDGED', 'RESPONDING');

create trigger sos_incidents_set_updated_at
  before update on public.sos_incidents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Who may drive an incident forward
--
-- The operator that owns the trip, its assigned crew (they are at the scene),
-- or an admin. SECURITY DEFINER so the policy and the RPCs can read
-- `trips` / `trip_assignments` without recursing through their own RLS.
-- ---------------------------------------------------------------------------

create or replace function public.can_manage_sos(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or (
      p_trip_id is not null and (
        exists (
          select 1 from public.trips t
          where t.id = p_trip_id and t.operator_id = public.current_operator_id()
        )
        or exists (
          select 1 from public.trip_assignments ta
          where ta.trip_id = p_trip_id
            and ta.status <> 'CANCELLED'
            and (
              ta.driver_id = public.current_driver_id()
              or ta.assistant_id = public.current_assistant_id()
            )
        )
      )
    );
$$;

revoke all on function public.can_manage_sos(uuid) from public, anon;
grant execute on function public.can_manage_sos(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Read your own alerts, or the alerts on a trip you run or crew. No client
-- write path at all — every transition is a SECURITY DEFINER function.
-- ---------------------------------------------------------------------------

alter table public.sos_incidents enable row level security;

create policy "Passengers and responders read relevant SOS incidents"
  on public.sos_incidents for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_manage_sos(trip_id)
  );

revoke insert, update, delete on public.sos_incidents from anon, authenticated;

-- ---------------------------------------------------------------------------
-- trigger_sos — raise an alert
--
-- Idempotent by the open-per-user index: a second call while an alert is still
-- open returns that alert rather than creating another.
-- ---------------------------------------------------------------------------

create or replace function public.trigger_sos(
  p_latitude numeric,
  p_longitude numeric,
  p_booking_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_trip_id uuid;
  v_incident public.sos_incidents%rowtype;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- Resolve the trip from the caller's own booking. An explicit booking id
  -- must belong to the caller; without one, take their most recent active
  -- booking. Either way the trip is derived, never taken from the client.
  if p_booking_id is not null then
    select b.trip_id into v_trip_id
    from public.bookings b
    where b.id = p_booking_id and b.user_id = v_user_id;

    if not found then
      raise exception 'FORBIDDEN';
    end if;
  else
    select b.trip_id into v_trip_id
    from public.bookings b
    where b.user_id = v_user_id
      and b.status in ('CONFIRMED', 'CHECKED_IN', 'BOARDED', 'ON_TRIP')
    order by b.created_at desc
    limit 1;
  end if;

  begin
    insert into public.sos_incidents (user_id, booking_id, trip_id, latitude, longitude)
    values (v_user_id, p_booking_id, v_trip_id, p_latitude, p_longitude)
    returning * into v_incident;
  exception when unique_violation then
    -- Already have an open alert. Return it — a repeat tap is not a new
    -- emergency.
    select * into v_incident
    from public.sos_incidents
    where user_id = v_user_id
      and status in ('ACTIVE', 'ACKNOWLEDGED', 'RESPONDING')
    limit 1;

    return jsonb_build_object(
      'id', v_incident.id,
      'status', v_incident.status,
      'tripId', v_incident.trip_id,
      'createdAt', v_incident.created_at,
      'alreadyOpen', true
    );
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id, 'SOS_TRIGGERED', 'sos_incident', v_incident.id,
    jsonb_build_object('tripId', v_incident.trip_id, 'bookingId', v_incident.booking_id)
  );

  insert into public.notifications (user_id, type, title, message, data)
  values (
    v_user_id, 'SOS', 'Emergency alert sent',
    'Your location has been shared with the operator. Help is being arranged.',
    jsonb_build_object('sosId', v_incident.id)
  );

  return jsonb_build_object(
    'id', v_incident.id,
    'status', v_incident.status,
    'tripId', v_incident.trip_id,
    'createdAt', v_incident.created_at,
    'alreadyOpen', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: advance an incident, once, with the right authorisation.
--
-- Private (no grant). The three public transitions below are thin wrappers so
-- each has its own name, audit action and notification wording.
-- ---------------------------------------------------------------------------

create or replace function public.sos_advance(
  p_sos_id uuid,
  p_to public.sos_status,
  p_from public.sos_status[],
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_incident public.sos_incidents%rowtype;
  v_changed boolean := false;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_incident from public.sos_incidents where id = p_sos_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  -- CANCELLED is the passenger's; everything else is a responder's.
  if p_to = 'CANCELLED' then
    if v_incident.user_id <> v_actor and not public.is_admin() then
      raise exception 'FORBIDDEN';
    end if;
  elsif not public.can_manage_sos(v_incident.trip_id) then
    raise exception 'FORBIDDEN';
  end if;

  if v_incident.status = p_to then
    -- Idempotent: a retry after a dropped response is ordinary.
    null;
  elsif v_incident.status = any(p_from) then
    update public.sos_incidents
       set status = p_to,
           acknowledged_at = case
             when p_to in ('ACKNOWLEDGED', 'RESPONDING', 'RESOLVED')
               then coalesce(acknowledged_at, now()) else acknowledged_at end,
           acknowledged_by = case
             when p_to = 'ACKNOWLEDGED' then coalesce(acknowledged_by, v_actor)
             else acknowledged_by end,
           responding_at = case
             when p_to = 'RESPONDING' then coalesce(responding_at, now())
             else responding_at end,
           resolved_at = case when p_to = 'RESOLVED' then now() else resolved_at end,
           resolved_by = case when p_to = 'RESOLVED' then v_actor else resolved_by end,
           note = coalesce(p_note, note)
     where id = p_sos_id
    returning * into v_incident;
    v_changed := true;
  else
    -- e.g. resolving something already CANCELLED, or cancelling a RESPONDING.
    raise exception 'INVALID_TRIP_STATUS';
  end if;

  if v_changed then
    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
    values (
      v_actor, 'SOS_' || p_to::text, 'sos_incident', v_incident.id,
      jsonb_build_object('tripId', v_incident.trip_id)
    );

    insert into public.notifications (user_id, type, title, message, data)
    values (
      v_incident.user_id, 'SOS',
      case p_to
        when 'ACKNOWLEDGED' then 'Help is being coordinated'
        when 'RESPONDING' then 'Responders are on the way'
        when 'RESOLVED' then 'Emergency assistance complete'
        when 'CANCELLED' then 'Emergency alert cancelled'
        else 'Emergency alert updated'
      end,
      case p_to
        when 'ACKNOWLEDGED' then 'The operator has seen your alert and is arranging assistance.'
        when 'RESPONDING' then 'Someone is on their way to you.'
        when 'RESOLVED' then 'Your emergency alert has been marked resolved.'
        when 'CANCELLED' then 'Your emergency alert has been cancelled.'
        else 'Your emergency alert has been updated.'
      end,
      jsonb_build_object('sosId', v_incident.id)
    );
  end if;

  return jsonb_build_object(
    'id', v_incident.id,
    'status', v_incident.status,
    'changed', v_changed,
    'acknowledgedAt', v_incident.acknowledged_at,
    'respondingAt', v_incident.responding_at,
    'resolvedAt', v_incident.resolved_at
  );
end;
$$;

revoke all on function public.sos_advance(uuid, public.sos_status, public.sos_status[], text)
  from public, anon, authenticated;

create or replace function public.acknowledge_sos(p_sos_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.sos_advance(p_sos_id, 'ACKNOWLEDGED', array['ACTIVE']::public.sos_status[], null);
$$;

create or replace function public.respond_sos(p_sos_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.sos_advance(
    p_sos_id, 'RESPONDING', array['ACTIVE', 'ACKNOWLEDGED']::public.sos_status[], null
  );
$$;

create or replace function public.resolve_sos(p_sos_id uuid, p_note text default null)
returns jsonb language sql security definer set search_path = '' as $$
  select public.sos_advance(
    p_sos_id, 'RESOLVED',
    array['ACTIVE', 'ACKNOWLEDGED', 'RESPONDING']::public.sos_status[], p_note
  );
$$;

-- The passenger stands down their own false alarm — but not once a responder
-- is already moving.
create or replace function public.cancel_sos(p_sos_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.sos_advance(
    p_sos_id, 'CANCELLED', array['ACTIVE', 'ACKNOWLEDGED']::public.sos_status[], null
  );
$$;

revoke all on function public.acknowledge_sos(uuid) from public, anon;
revoke all on function public.respond_sos(uuid) from public, anon;
revoke all on function public.resolve_sos(uuid, text) from public, anon;
revoke all on function public.cancel_sos(uuid) from public, anon;
grant execute on function public.acknowledge_sos(uuid) to authenticated;
grant execute on function public.respond_sos(uuid) to authenticated;
grant execute on function public.resolve_sos(uuid, text) to authenticated;
grant execute on function public.cancel_sos(uuid) to authenticated;
grant execute on function public.trigger_sos(numeric, numeric, uuid) to authenticated;
revoke all on function public.trigger_sos(numeric, numeric, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Realtime
--
-- The operator console and the passenger's own screen both subscribe.
-- `replica identity full` so a status UPDATE carries the whole row rather than
-- just the primary key.
-- ---------------------------------------------------------------------------

alter table public.sos_incidents replica identity full;
alter publication supabase_realtime add table public.sos_incidents;
