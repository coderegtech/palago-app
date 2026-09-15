-- Deactivation reaches the passenger, and reference data becomes editable.
--
-- `operators`, `routes`, `buses` and `terminals` have all carried a `status`
-- column since Phase 3a, and nothing has ever read it. `trip_search` joins all
-- four and never asks; `create_booking` loads the trip and never asks. So a
-- coach taken off the road, or an operator suspended, kept selling seats.
--
-- Two halves, and the distinction matters:
--
--   * the view gains the status columns so search can hide what is inactive.
--     That is presentation, and it is deliberately not a filter inside the view
--     — `getTrip` reads the same view to render a ticket somebody already
--     holds, and a bus withdrawn after they booked must not 404 their booking.
--   * `create_booking` REFUSES an inactive operator, route or bus. That is the
--     enforcement. A client that queries the view differently, or calls the RPC
--     directly, still cannot sell a seat on a withdrawn coach.
--
-- And the management half: edit and activate/deactivate for all four tables,
-- audited, with direct writes withdrawn so nothing can change a company's name
-- without leaving a trace.

-- ---------------------------------------------------------------------------
-- trip_search
--
-- Same projection plus four columns. `security_invoker` stays on: the view
-- must keep running with the caller's RLS, or it becomes a way around it.
-- ---------------------------------------------------------------------------

drop view public.trip_search;

create view public.trip_search with (security_invoker = true) as
select
  t.id,
  t.trip_number,
  t.departure_date,
  t.departure_time,
  t.arrival_time,
  t.departure_at,
  t.arrival_at,
  t.fare,
  t.status,
  t.is_active,
  t.operator_id,
  o.name  as operator_name,
  o.code  as operator_code,
  o.status as operator_status,
  t.route_id,
  r.duration_minutes,
  r.distance_km,
  r.status as route_status,
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
  b.status as bus_status,
  public.trip_available_seats(t.id) as available_seats
from public.trips t
join public.operators o on o.id = t.operator_id
join public.routes r on r.id = t.route_id
join public.terminals ot on ot.id = r.origin_terminal_id
join public.terminals dt on dt.id = r.destination_terminal_id
join public.buses b on b.id = t.bus_id;

comment on view public.trip_search is
  'Denormalised trip projection for search, with the status of everything a sale depends on. Runs with the caller''s RLS. Not filtered: getTrip reads it for tickets already sold.';

revoke all on public.trip_search from anon;
grant select on public.trip_search to authenticated;

-- ---------------------------------------------------------------------------
-- Reference data stops being writable directly
--
-- The Phase 3a policies let an admin (and an operator, for their own rows)
-- INSERT and UPDATE these tables straight. That was fine while the only action
-- was "add one"; it is not fine now that there is an edit form and a
-- deactivate button, because a status change that leaves no audit trail cannot
-- answer "who took that bus off the road, and when".
--
-- SELECT policies are untouched. Trip search still needs to read all four.
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.operators from anon, authenticated;
revoke insert, update, delete on public.terminals from anon, authenticated;
revoke insert, update, delete on public.routes from anon, authenticated;
revoke insert, update, delete on public.buses from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Operators
-- ---------------------------------------------------------------------------

create or replace function public.create_operator(
  p_name text,
  p_code text,
  p_description text default null,
  p_contact_phone text default null,
  p_contact_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if coalesce(trim(coalesce(p_name, '')), '') = ''
     or coalesce(trim(coalesce(p_code, '')), '') = '' then
    raise exception 'VALIDATION_ERROR';
  end if;

  begin
    insert into public.operators (name, code, description, contact_phone, contact_email)
    values (
      trim(p_name), upper(trim(p_code)),
      nullif(trim(coalesce(p_description, '')), ''),
      nullif(trim(coalesce(p_contact_phone, '')), ''),
      nullif(trim(coalesce(p_contact_email, '')), '')
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'VALIDATION_ERROR';
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'OPERATOR_CREATED', 'operator', v_id,
    jsonb_build_object('name', trim(p_name), 'code', upper(trim(p_code)))
  );

  return jsonb_build_object('id', v_id, 'code', upper(trim(p_code)));
end;
$$;

create or replace function public.update_operator(
  p_operator_id uuid,
  p_name text,
  p_description text default null,
  p_contact_phone text default null,
  p_contact_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_before public.operators%rowtype;
begin
  select * into v_before from public.operators where id = p_operator_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  -- An operator may correct their own contact details; the code is identity and
  -- belongs to the admin who issued it, so it is not editable here at all.
  if not (public.is_admin() or public.can_manage_operator(p_operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if coalesce(trim(coalesce(p_name, '')), '') = '' then
    raise exception 'VALIDATION_ERROR';
  end if;

  update public.operators
     set name = trim(p_name),
         description = nullif(trim(coalesce(p_description, '')), ''),
         contact_phone = nullif(trim(coalesce(p_contact_phone, '')), ''),
         contact_email = nullif(trim(coalesce(p_contact_email, '')), '')
   where id = p_operator_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'OPERATOR_UPDATED', 'operator', p_operator_id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'name', v_before.name, 'description', v_before.description,
        'contactPhone', v_before.contact_phone, 'contactEmail', v_before.contact_email
      ),
      'after', jsonb_build_object(
        'name', trim(p_name),
        'description', nullif(trim(coalesce(p_description, '')), ''),
        'contactPhone', nullif(trim(coalesce(p_contact_phone, '')), ''),
        'contactEmail', nullif(trim(coalesce(p_contact_email, '')), '')
      )
    )
  );

  return jsonb_build_object('id', p_operator_id);
end;
$$;

-- Deactivating a company stops its trips being sold. It deliberately does NOT
-- lock its staff out — that is `set_account_status`, a separate decision, so
-- the people who have to wind the schedule down can still get in.
create or replace function public.set_operator_status(
  p_operator_id uuid,
  p_status public.operator_status,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_before public.operator_status;
  v_upcoming integer;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_before from public.operators where id = p_operator_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_before = p_status then
    return jsonb_build_object('id', p_operator_id, 'status', p_status, 'changed', false);
  end if;

  update public.operators set status = p_status where id = p_operator_id;

  select count(*) into v_upcoming
    from public.trips t
   where t.operator_id = p_operator_id
     and t.status in ('SCHEDULED', 'BOARDING')
     and t.departure_at >= now()::timestamp;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    case when p_status = 'ACTIVE' then 'OPERATOR_ACTIVATED' else 'OPERATOR_DEACTIVATED' end,
    'operator', p_operator_id,
    jsonb_build_object('reason', p_reason, 'upcomingTrips', v_upcoming)
  );

  -- The count is returned, not acted on: trips already sold stay sold and stay
  -- travellable. What changes is that no new seat can be bought on them.
  return jsonb_build_object(
    'id', p_operator_id, 'status', p_status, 'changed', true, 'upcomingTrips', v_upcoming
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Terminals
-- ---------------------------------------------------------------------------

create or replace function public.create_terminal(
  p_name text,
  p_code text,
  p_city text,
  p_latitude numeric,
  p_longitude numeric,
  p_province text default 'Palawan',
  p_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if coalesce(trim(coalesce(p_name, '')), '') = ''
     or coalesce(trim(coalesce(p_code, '')), '') = ''
     or coalesce(trim(coalesce(p_city, '')), '') = ''
     or p_latitude is null or p_longitude is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  begin
    insert into public.terminals (name, code, city, province, latitude, longitude, address)
    values (
      trim(p_name), upper(trim(p_code)), trim(p_city),
      coalesce(nullif(trim(coalesce(p_province, '')), ''), 'Palawan'),
      p_latitude, p_longitude, nullif(trim(coalesce(p_address, '')), '')
    )
    returning id into v_id;
  exception
    when unique_violation then raise exception 'VALIDATION_ERROR';
    when check_violation then raise exception 'VALIDATION_ERROR';
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'TERMINAL_CREATED', 'terminal', v_id,
    jsonb_build_object('name', trim(p_name), 'code', upper(trim(p_code)))
  );

  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.update_terminal(
  p_terminal_id uuid,
  p_name text,
  p_city text,
  p_latitude numeric,
  p_longitude numeric,
  p_province text default 'Palawan',
  p_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_before public.terminals%rowtype;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_before from public.terminals where id = p_terminal_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if coalesce(trim(coalesce(p_name, '')), '') = ''
     or coalesce(trim(coalesce(p_city, '')), '') = ''
     or p_latitude is null or p_longitude is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  begin
    update public.terminals
       set name = trim(p_name),
           city = trim(p_city),
           province = coalesce(nullif(trim(coalesce(p_province, '')), ''), 'Palawan'),
           latitude = p_latitude,
           longitude = p_longitude,
           address = nullif(trim(coalesce(p_address, '')), '')
     where id = p_terminal_id;
  exception
    when check_violation then raise exception 'VALIDATION_ERROR';
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'TERMINAL_UPDATED', 'terminal', p_terminal_id,
    jsonb_build_object(
      'before', jsonb_build_object('name', v_before.name, 'city', v_before.city),
      'after', jsonb_build_object('name', trim(p_name), 'city', trim(p_city))
    )
  );

  return jsonb_build_object('id', p_terminal_id);
end;
$$;

create or replace function public.set_terminal_status(
  p_terminal_id uuid,
  p_status public.operator_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_before public.operator_status;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_before from public.terminals where id = p_terminal_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_before = p_status then
    return jsonb_build_object('id', p_terminal_id, 'status', p_status, 'changed', false);
  end if;

  update public.terminals set status = p_status where id = p_terminal_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    case when p_status = 'ACTIVE' then 'TERMINAL_ACTIVATED' else 'TERMINAL_DEACTIVATED' end,
    'terminal', p_terminal_id, '{}'::jsonb
  );

  return jsonb_build_object('id', p_terminal_id, 'status', p_status, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Routes
-- ---------------------------------------------------------------------------

create or replace function public.create_route(
  p_operator_id uuid,
  p_origin_terminal_id uuid,
  p_destination_terminal_id uuid,
  p_duration_minutes integer,
  p_distance_km numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
begin
  if not (public.is_admin() or public.can_manage_operator(p_operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if p_duration_minutes is null or p_duration_minutes <= 0
     or p_origin_terminal_id is null or p_destination_terminal_id is null
     or p_origin_terminal_id = p_destination_terminal_id then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- A route between terminals that are closed is a route nobody can travel.
  if exists (
    select 1 from public.terminals
     where id in (p_origin_terminal_id, p_destination_terminal_id)
       and status <> 'ACTIVE'
  ) then
    raise exception 'INACTIVE_RESOURCE';
  end if;

  begin
    insert into public.routes (
      operator_id, origin_terminal_id, destination_terminal_id, duration_minutes, distance_km
    )
    values (
      p_operator_id, p_origin_terminal_id, p_destination_terminal_id,
      p_duration_minutes, p_distance_km
    )
    returning id into v_id;
  exception
    when unique_violation then raise exception 'VALIDATION_ERROR';
    when check_violation then raise exception 'VALIDATION_ERROR';
    when foreign_key_violation then raise exception 'NOT_FOUND';
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'ROUTE_CREATED', 'route', v_id,
    jsonb_build_object(
      'operatorId', p_operator_id,
      'originTerminalId', p_origin_terminal_id,
      'destinationTerminalId', p_destination_terminal_id,
      'durationMinutes', p_duration_minutes
    )
  );

  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.update_route(
  p_route_id uuid,
  p_duration_minutes integer,
  p_distance_km numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_before public.routes%rowtype;
begin
  select * into v_before from public.routes where id = p_route_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if not (public.is_admin() or public.can_manage_operator(v_before.operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- The terminals are not editable: changing where a route goes would silently
  -- re-point every trip and every ticket already sold on it. That is a new
  -- route, not an edit.
  update public.routes
     set duration_minutes = p_duration_minutes,
         distance_km = p_distance_km
   where id = p_route_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'ROUTE_UPDATED', 'route', p_route_id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'durationMinutes', v_before.duration_minutes, 'distanceKm', v_before.distance_km
      ),
      'after', jsonb_build_object(
        'durationMinutes', p_duration_minutes, 'distanceKm', p_distance_km
      )
    )
  );

  return jsonb_build_object('id', p_route_id);
end;
$$;

create or replace function public.set_route_status(
  p_route_id uuid,
  p_status public.operator_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_route public.routes%rowtype;
begin
  select * into v_route from public.routes where id = p_route_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if not (public.is_admin() or public.can_manage_operator(v_route.operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if v_route.status = p_status then
    return jsonb_build_object('id', p_route_id, 'status', p_status, 'changed', false);
  end if;

  update public.routes set status = p_status where id = p_route_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    case when p_status = 'ACTIVE' then 'ROUTE_ACTIVATED' else 'ROUTE_DEACTIVATED' end,
    'route', p_route_id, '{}'::jsonb
  );

  return jsonb_build_object('id', p_route_id, 'status', p_status, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Buses
--
-- `create_bus` already exists (it builds the seat layout with the coach, so the
-- two cannot disagree) and is left alone. What is added is editing, moving a
-- coach between operators, and taking one off the road.
-- ---------------------------------------------------------------------------

create or replace function public.update_bus(
  p_bus_id uuid,
  p_bus_number text,
  p_plate_number text,
  p_name text default null,
  -- Admin only. An operator cannot hand their coach to another company, and
  -- cannot take one.
  p_operator_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_before public.buses%rowtype;
  v_target_operator uuid;
begin
  select * into v_before from public.buses where id = p_bus_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if not (public.is_admin() or public.can_manage_operator(v_before.operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if coalesce(trim(coalesce(p_bus_number, '')), '') = ''
     or coalesce(trim(coalesce(p_plate_number, '')), '') = '' then
    raise exception 'VALIDATION_ERROR';
  end if;

  v_target_operator := coalesce(p_operator_id, v_before.operator_id);

  if v_target_operator <> v_before.operator_id then
    if not public.is_admin() then
      raise exception 'FORBIDDEN';
    end if;

    -- Reassigning a coach that is on somebody's schedule would leave trips
    -- pointing at another company's bus, and `operator_fleet` would stop
    -- showing it to the operator running those departures.
    if exists (
      select 1 from public.trips t
       where t.bus_id = p_bus_id
         and t.status not in ('COMPLETED', 'CANCELLED')
    ) then
      raise exception 'VALIDATION_ERROR';
    end if;
  end if;

  -- Capacity is not editable: `bus_seats` was generated from it, and changing
  -- the number without regenerating the layout would make the seat map lie.
  begin
    update public.buses
       set bus_number = trim(p_bus_number),
           plate_number = trim(p_plate_number),
           name = nullif(trim(coalesce(p_name, '')), ''),
           operator_id = v_target_operator
     where id = p_bus_id;
  exception
    when unique_violation then raise exception 'VALIDATION_ERROR';
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor, 'BUS_UPDATED', 'bus', p_bus_id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'busNumber', v_before.bus_number, 'plateNumber', v_before.plate_number,
        'name', v_before.name, 'operatorId', v_before.operator_id
      ),
      'after', jsonb_build_object(
        'busNumber', trim(p_bus_number), 'plateNumber', trim(p_plate_number),
        'name', nullif(trim(coalesce(p_name, '')), ''), 'operatorId', v_target_operator
      )
    )
  );

  return jsonb_build_object('id', p_bus_id, 'operatorId', v_target_operator);
end;
$$;

create or replace function public.set_bus_status(
  p_bus_id uuid,
  p_status public.operator_status,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_bus public.buses%rowtype;
  v_upcoming integer;
begin
  select * into v_bus from public.buses where id = p_bus_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if not (public.is_admin() or public.can_manage_operator(v_bus.operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if v_bus.status = p_status then
    return jsonb_build_object('id', p_bus_id, 'status', p_status, 'changed', false);
  end if;

  update public.buses set status = p_status where id = p_bus_id;

  select count(*) into v_upcoming
    from public.trips t
   where t.bus_id = p_bus_id
     and t.status in ('SCHEDULED', 'BOARDING')
     and t.departure_at >= now()::timestamp;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    case when p_status = 'ACTIVE' then 'BUS_ACTIVATED' else 'BUS_DEACTIVATED' end,
    'bus', p_bus_id,
    jsonb_build_object(
      'busNumber', v_bus.bus_number, 'reason', p_reason, 'upcomingTrips', v_upcoming
    )
  );

  -- Those upcoming trips are NOT cancelled here. Taking a coach off the road
  -- stops it being scheduled again and stops new seats being sold on what is
  -- already scheduled; whether a departure still runs, on another bus or not at
  -- all, is a decision with passengers attached and is made per trip.
  return jsonb_build_object(
    'id', p_bus_id, 'status', p_status, 'changed', true, 'upcomingTrips', v_upcoming
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.create_operator(text, text, text, text, text) from public, anon;
revoke all on function public.update_operator(uuid, text, text, text, text) from public, anon;
revoke all on function public.set_operator_status(uuid, public.operator_status, text) from public, anon;
revoke all on function public.create_terminal(text, text, text, numeric, numeric, text, text) from public, anon;
revoke all on function public.update_terminal(uuid, text, text, numeric, numeric, text, text) from public, anon;
revoke all on function public.set_terminal_status(uuid, public.operator_status) from public, anon;
revoke all on function public.create_route(uuid, uuid, uuid, integer, numeric) from public, anon;
revoke all on function public.update_route(uuid, integer, numeric) from public, anon;
revoke all on function public.set_route_status(uuid, public.operator_status) from public, anon;
revoke all on function public.update_bus(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.set_bus_status(uuid, public.operator_status, text) from public, anon;

grant execute on function public.create_operator(text, text, text, text, text) to authenticated;
grant execute on function public.update_operator(uuid, text, text, text, text) to authenticated;
grant execute on function public.set_operator_status(uuid, public.operator_status, text) to authenticated;
grant execute on function public.create_terminal(text, text, text, numeric, numeric, text, text) to authenticated;
grant execute on function public.update_terminal(uuid, text, text, numeric, numeric, text, text) to authenticated;
grant execute on function public.set_terminal_status(uuid, public.operator_status) to authenticated;
grant execute on function public.create_route(uuid, uuid, uuid, integer, numeric) to authenticated;
grant execute on function public.update_route(uuid, integer, numeric) to authenticated;
grant execute on function public.set_route_status(uuid, public.operator_status) to authenticated;
grant execute on function public.update_bus(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.set_bus_status(uuid, public.operator_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_booking, patched to refuse what is no longer in service
--
-- Extracted from the live definition and patched at ONE anchor. Everything the
-- booking path depends on comes through untouched, and the migration script
-- asserted it: the capacity hold's `for update of ts skip locked`, the
-- lapsed-hold reclaim, the ten-seat and blank-name guards, the
-- verified-discount pricing and the counter-sale staff gate. (This function's
-- ancestor was once rewritten from memory and quietly lost its deadlock
-- guard — see AGENTS.md.)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_booking(p_trip_id uuid, p_passengers jsonb, p_seat_ids uuid[] DEFAULT NULL::uuid[], p_walk_in boolean DEFAULT false, p_source booking_source DEFAULT 'MOBILE_APP'::booking_source, p_ticket_type ticket_type DEFAULT 'DIGITAL'::ticket_type)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id       uuid := (select auth.uid());
  v_owner         uuid;
  v_is_staff      boolean;
  v_trip          public.trips%rowtype;
  v_seat_ids      uuid[];
  v_seat_count    integer;
  v_booking_id    uuid;
  v_reference     text;
  v_subtotal      integer;
  v_expires_at    timestamptz;
  v_kind          public.discount_kind;
  v_discount      integer := 0;
  v_discounted_ord bigint;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if jsonb_typeof(p_passengers) <> 'array' or jsonb_array_length(p_passengers) = 0 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- A booking with no account holder, a chosen seat, or a counter source is a
  -- counter sale. Only staff may make one — otherwise anyone could create
  -- ownerless bookings that no passenger could be billed for or contacted about.
  if p_walk_in or p_seat_ids is not null
     or p_source <> 'MOBILE_APP' or p_ticket_type <> 'DIGITAL' then
    select public.can_manage_operator(t.operator_id) or coalesce(public.is_admin(), false)
      into v_is_staff
      from public.trips t
     where t.id = p_trip_id;

    if not coalesce(v_is_staff, false) then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  -- Whose booking this is. Null for a walk-in: it belongs to the passenger and
  -- the trip, not to a login. `created_by` below still records who made it.
  v_owner := case when p_walk_in then null else v_user_id end;

  v_seat_count := jsonb_array_length(p_passengers);

  if v_seat_count > 10 then
    raise exception 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_passengers) as p
    where coalesce(trim(p ->> 'name'), '') = ''
  ) then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_trip from public.trips where id = p_trip_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  -- Only a scheduled or boarding trip can be sold.
  if v_trip.status not in ('SCHEDULED', 'BOARDING') then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- And only one whose operator, route and coach are all still in service.
  -- The search view hides these; this is what makes hiding them mean anything,
  -- because a client can query the view differently or call this RPC directly.
  -- Tickets already sold are untouched — they remain readable and travellable.
  if not v_trip.is_active then
    raise exception 'INACTIVE_RESOURCE';
  end if;

  if not exists (
    select 1
      from public.operators o
      join public.routes r on r.id = v_trip.route_id
      join public.buses b on b.id = v_trip.bus_id
     where o.id = v_trip.operator_id
       and o.status = 'ACTIVE'
       and r.status = 'ACTIVE'
       and b.status = 'ACTIVE'
  ) then
    raise exception 'INACTIVE_RESOURCE';
  end if;

  -- Reclaim holds that have already lapsed, so an abandoned checkout does not
  -- make a bus look full when the sweep simply has not run yet.
  update public.trip_seats
     set status = 'AVAILABLE', booking_id = null, held_by = null, held_until = null
   where trip_id = p_trip_id
     and status = 'HELD'
     and held_until < now();

  if p_seat_ids is null then
    -- The system picks. SKIP LOCKED: a concurrent buyer takes the next free
    -- seat rather than waiting for this one and then failing.
    select coalesce(array_agg(s.seat_id), '{}')
      into v_seat_ids
      from (
        select ts.seat_id
          from public.trip_seats ts
          join public.bus_seats bs on bs.id = ts.seat_id
         where ts.trip_id = p_trip_id
           and ts.status = 'AVAILABLE'
         order by bs.row_number, bs.column_number, bs.seat_number
         limit v_seat_count
         for update of ts skip locked
      ) s;

    if coalesce(array_length(v_seat_ids, 1), 0) <> v_seat_count then
      raise exception 'SEAT_UNAVAILABLE';
    end if;
  else
    v_seat_ids := p_seat_ids;

    if coalesce(array_length(v_seat_ids, 1), 0) <> v_seat_count
       or (select count(distinct s) from unnest(v_seat_ids) as s) <> v_seat_count then
      raise exception 'VALIDATION_ERROR';
    end if;

    -- Lock in a consistent order, then judge availability: the ordering is what
    -- stops two counters deadlocking on overlapping seat sets.
    perform 1
       from public.trip_seats
      where trip_id = p_trip_id
        and seat_id = any(v_seat_ids)
      order by seat_id
      for update;

    if (
      select count(*) from public.trip_seats
       where trip_id = p_trip_id and seat_id = any(v_seat_ids) and status = 'AVAILABLE'
    ) <> v_seat_count then
      raise exception 'SEAT_UNAVAILABLE';
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- Price is computed here from the trip's own fare. Nothing about the amount
  -- comes from the caller.
  -- -------------------------------------------------------------------------
  v_subtotal   := v_trip.fare * v_seat_count;
  v_expires_at := now() + interval '10 minutes';
  v_reference  := public.next_booking_reference();

  -- The discount is derived from an APPROVED eligibility row, which the client
  -- has no write path to. A passenger who types SENIOR without verified proof
  -- pays the ordinary fare. It attaches to a passenger *line* now rather than a
  -- seat, because no seat has been assigned yet.
  -- A walk-in has no account, so no verified eligibility on file: they pay the
  -- ordinary fare. (Reading the *clerk's* eligibility here would have given a
  -- stranger the clerk's senior discount.)
  v_kind := case when v_owner is null then null else public.active_discount_kind(v_owner) end;

  if v_kind is not null then
    select t.ord
      into v_discounted_ord
      from jsonb_array_elements(p_passengers) with ordinality as t(p, ord)
     where coalesce(nullif(t.p ->> 'type', ''), 'ADULT') = v_kind::text
     order by t.ord
     limit 1;

    if v_discounted_ord is not null then
      v_discount := round(v_trip.fare * public.discount_rate_bps() / 10000.0);
    end if;
  end if;

  insert into public.bookings (
    user_id, created_by, source, ticket_type, trip_id, booking_reference, status,
    subtotal, discount, loyalty_discount, total_amount, expires_at
  )
  values (
    v_owner, v_user_id, p_source, p_ticket_type, p_trip_id, v_reference, 'PAYMENT_PENDING',
    v_subtotal, v_discount, 0, v_subtotal - v_discount, v_expires_at
  )
  returning id into v_booking_id;

  insert into public.booking_passengers (
    booking_id, user_id, seat_id, passenger_name, phone, email, passenger_type,
    discount_amount, discount_kind
  )
  select
    v_booking_id,
    v_owner,
    null,
    trim(t.p ->> 'name'),
    nullif(trim(coalesce(t.p ->> 'phone', '')), ''),
    nullif(trim(coalesce(t.p ->> 'email', '')), ''),
    coalesce(nullif(t.p ->> 'type', ''), 'ADULT')::public.passenger_type,
    case when t.ord = v_discounted_ord then v_discount else 0 end,
    case when t.ord = v_discounted_ord then v_kind else null end
  from jsonb_array_elements(p_passengers) with ordinality as t(p, ord);

  update public.trip_seats
     set status = 'HELD',
         booking_id = v_booking_id,
         held_by = v_user_id,
         held_until = v_expires_at
   where trip_id = p_trip_id
     and seat_id = any(v_seat_ids);

  return jsonb_build_object(
    'bookingId', v_booking_id,
    'reference', v_reference,
    'status', 'PAYMENT_PENDING',
    'subtotal', v_subtotal,
    'discount', v_discount,
    'discountKind', v_kind,
    'loyaltyDiscount', 0,
    'totalAmount', v_subtotal - v_discount,
    'currency', 'PHP',
    'seatCount', v_seat_count,
    'source', p_source,
    'ticketType', p_ticket_type,
    -- Deliberately not a seat list: nobody has a seat number until they pay.
    'seatsAssigned', false,
    'expiresAt', v_expires_at
  );
end;
$function$;

revoke all on function public.create_booking(
  uuid, jsonb, uuid[], boolean, public.booking_source, public.ticket_type
) from public, anon;
grant execute on function public.create_booking(
  uuid, jsonb, uuid[], boolean, public.booking_source, public.ticket_type
) to authenticated;
