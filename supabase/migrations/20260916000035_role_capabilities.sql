-- ---------------------------------------------------------------------------
-- What each role can do, where the hierarchy asked for something new.
--
-- Most of the specification was already true: operator isolation, the two
-- status fields, assignment validation, schedule conflict constraints and
-- backend-enforced RBAC all landed in migrations 30-33. Two things were not.
--
--   1. Drivers and crew could not set their own availability. `set_crew_availability`
--      authorises through `can_manage_operator`, so only a manager could mark
--      somebody unavailable. The hierarchy gives that to the person themselves:
--      a driver going off-shift says so, and stops being rostered, without
--      asking anyone.
--
--   2. Nothing could be deleted. The specification asks for delete on operators,
--      buses and schedules; the standing invariant is that reference data is
--      never hard-deleted because bookings, payments, tickets and boarding scans
--      point at it.
--
--      Both are right, and the specification itself says "delete schedules
--      **when allowed**". So delete here means: remove the row when nothing
--      references it, and refuse — naming what is in the way — when something
--      does. A never-used bus added by mistake goes. A coach that has carried
--      passengers is stood down instead, and the refusal says so rather than
--      failing on a foreign key the operator cannot interpret.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. A driver or crew member sets their own availability
--
-- Availability is not account status and this does not blur them. Marking
-- yourself unavailable stops you being rostered onto a NEW trip; it does not
-- sign you out, does not touch trips you are already on, and cannot be used to
-- walk away from a departure you are committed to. Only an OPERATOR_ADMIN can
-- disable an account, and only an OPERATOR_ADMIN can take somebody off a trip
-- that is already assigned.
-- ---------------------------------------------------------------------------

create or replace function public.set_my_availability(
  p_status public.availability_status,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.active_uid();
  v_driver_id uuid := public.current_driver_id();
  v_crew_id uuid := public.current_assistant_id();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_kind text;
  v_id uuid;
begin
  -- `active_uid()` rather than `auth.uid()`: a deactivated account holds a
  -- valid token for up to an hour, and must not be able to change anything.
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if v_driver_id is not null then
    v_kind := 'DRIVER';
    v_id := v_driver_id;
    update public.drivers
       set availability_status = p_status,
           unavailable_reason = case when p_status = 'UNAVAILABLE' then v_reason else null end,
           updated_at = now()
     where id = v_driver_id;
  elsif v_crew_id is not null then
    v_kind := 'CREW';
    v_id := v_crew_id;
    update public.assistants
       set availability_status = p_status,
           unavailable_reason = case when p_status = 'UNAVAILABLE' then v_reason else null end,
           updated_at = now()
     where id = v_crew_id;
  else
    -- A passenger, an operator manager or a platform administrator. None of
    -- them is rostered onto anything, so none of them has an availability.
    raise exception 'FORBIDDEN';
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    'AVAILABILITY_SET_SELF',
    lower(v_kind),
    v_id,
    jsonb_build_object('status', p_status, 'reason', v_reason)
  );

  return jsonb_build_object('kind', v_kind, 'id', v_id, 'availabilityStatus', p_status);
end;
$$;

revoke all on function public.set_my_availability(public.availability_status, text) from public, anon;
grant execute on function public.set_my_availability(public.availability_status, text) to authenticated;

comment on function public.set_my_availability(public.availability_status, text) is
  'A driver or crew member sets their own availability. Gates future rostering only — it does not sign them out and does not release trips already assigned.';

-- ---------------------------------------------------------------------------
-- 2. Delete when nothing points at it, refuse when something does
--
-- Each of these returns rather than raising on the "cannot" path, so the
-- console can say *why* — "3 trips and 12 bookings reference this coach" — and
-- offer deactivation instead. A raise would roll back and leave the screen with
-- a code it cannot turn into a sentence.
-- ---------------------------------------------------------------------------

create or replace function public.delete_bus(p_bus_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid;
  v_trips int;
  v_seats int;
begin
  select operator_id into v_operator_id from public.buses where id = p_bus_id;
  if v_operator_id is null then
    raise exception 'NOT_FOUND';
  end if;

  if not (public.is_admin() or public.can_manage_operator(v_operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  select count(*) into v_trips from public.trips where bus_id = p_bus_id;

  if v_trips > 0 then
    return jsonb_build_object(
      'deleted', false,
      'reason', 'IN_USE',
      'trips', v_trips,
      'message', format('This coach is on %s scheduled trip(s). Set it inactive instead — the history stays.', v_trips)
    );
  end if;

  -- Never carried anybody. The seat layout is its own and goes with it.
  select count(*) into v_seats from public.bus_seats where bus_id = p_bus_id;
  delete from public.bus_seats where bus_id = p_bus_id;
  delete from public.buses where id = p_bus_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), 'BUS_DELETED', 'bus', p_bus_id,
          jsonb_build_object('operatorId', v_operator_id, 'seats', v_seats));

  return jsonb_build_object('deleted', true, 'seats', v_seats);
end;
$$;

create or replace function public.delete_trip(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid;
  v_status public.trip_status;
  v_bookings int;
  v_scans int;
begin
  select operator_id, status into v_operator_id, v_status
    from public.trips where id = p_trip_id;
  if v_operator_id is null then
    raise exception 'NOT_FOUND';
  end if;

  if not (public.is_admin() or public.can_manage_operator(v_operator_id)) then
    raise exception 'FORBIDDEN';
  end if;

  select count(*) into v_bookings from public.bookings where trip_id = p_trip_id;
  select count(*) into v_scans from public.qr_scans
   where trip_id = p_trip_id or ticket_trip_id = p_trip_id;

  if v_bookings > 0 or v_scans > 0 then
    return jsonb_build_object(
      'deleted', false,
      'reason', 'HAS_HISTORY',
      'bookings', v_bookings,
      'scans', v_scans,
      'message', format(
        'This departure has %s booking(s) and %s boarding scan(s). Cancel it instead — passengers are told and refunded, and the record is kept.',
        v_bookings, v_scans)
    );
  end if;

  -- Nobody ever booked it. Its seat inventory, crew assignments and any GPS
  -- trail go with it by cascade; there is no passenger-facing history to lose.
  delete from public.trips where id = p_trip_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), 'TRIP_DELETED', 'trip', p_trip_id,
          jsonb_build_object('operatorId', v_operator_id, 'status', v_status));

  return jsonb_build_object('deleted', true);
end;
$$;

create or replace function public.delete_operator(p_operator_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_trips int;
  v_buses int;
  v_staff int;
begin
  select true into v_exists from public.operators where id = p_operator_id;
  if not coalesce(v_exists, false) then
    raise exception 'NOT_FOUND';
  end if;

  -- Only the platform administrator, and `is_admin()` is gated on account
  -- status. `coalesce` is not needed here because this is a bare boolean, but
  -- the comparison below is the shape that bit `create_bus` once: a NULL in an
  -- `if not (...)` never fires.
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select count(*) into v_trips from public.trips where operator_id = p_operator_id;
  select count(*) into v_buses from public.buses where operator_id = p_operator_id;
  select count(*) into v_staff from public.profiles where operator_id = p_operator_id;

  if v_trips > 0 or v_buses > 0 or v_staff > 0 then
    return jsonb_build_object(
      'deleted', false,
      'reason', 'HAS_RESOURCES',
      'trips', v_trips,
      'buses', v_buses,
      'staff', v_staff,
      'message', format(
        'This company has %s trip(s), %s coach(es) and %s staff account(s). Deactivate it instead — its tickets, payments and receipts all point at it.',
        v_trips, v_buses, v_staff)
    );
  end if;

  delete from public.operators where id = p_operator_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), 'OPERATOR_DELETED', 'operator', p_operator_id, '{}'::jsonb);

  return jsonb_build_object('deleted', true);
end;
$$;

revoke all on function public.delete_bus(uuid) from public, anon;
revoke all on function public.delete_trip(uuid) from public, anon;
revoke all on function public.delete_operator(uuid) from public, anon;
grant execute on function public.delete_bus(uuid) to authenticated;
grant execute on function public.delete_trip(uuid) to authenticated;
grant execute on function public.delete_operator(uuid) to authenticated;

comment on function public.delete_bus(uuid) is
  'Removes a coach that has never been scheduled. Returns deleted=false with a count when it has.';
comment on function public.delete_trip(uuid) is
  'Removes a departure nobody booked. Returns deleted=false with counts when it has bookings or scans.';
comment on function public.delete_operator(uuid) is
  'Removes a company with no trips, coaches or staff. Returns deleted=false with counts otherwise.';
