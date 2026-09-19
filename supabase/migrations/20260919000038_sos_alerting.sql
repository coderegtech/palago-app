-- ---------------------------------------------------------------------------
-- SOS: an emergency alert that actually alerts somebody.
--
-- Found by raising one as the seeded passenger and looking from each side:
--
--   1. Nobody was told. `trigger_sos` wrote one notification — to the
--      passenger who pressed the button. The operator running the trip, its
--      driver and its crew got nothing, so the alert existed only for whoever
--      happened to have the operator dashboard open at that moment.
--   2. The responders could not tell who was in trouble. RLS showed them the
--      incident row but not the passenger's profile, so the console had a pair
--      of coordinates and no name, no phone number, no trip and no coach.
--   3. The passenger was promised "Help is being arranged" before anybody had
--      seen the alert — the one promise Phase 11 said the app must not make.
--   4. The trip was the caller's most recently *created* live booking. A
--      passenger on the bus today who had booked next week's return yesterday
--      had their alert filed against next week's trip — a trip with another
--      crew, possibly another operator.
--
-- Also: `auth.uid()` → `active_uid()`, so a deactivated account whose token is
-- still inside its hour cannot raise alerts (AGENTS.md, "active_uid()").
-- ---------------------------------------------------------------------------

-- Who must hear about an alert: the operator admins of the trip's operator,
-- the driver and crew rostered on it, and every admin. Active accounts only.
-- A trip-less alert (raised before boarding) goes to the admins alone, who are
-- the only people able to see it.
create or replace function public.sos_responder_ids(p_trip_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
    from public.profiles p
   where p.account_status = 'ACTIVE'
     and (
       p.role = 'SUPER_ADMIN'
       or (
         p_trip_id is not null
         and p.role = 'OPERATOR_ADMIN'
         and p.operator_id = (select t.operator_id from public.trips t where t.id = p_trip_id)
       )
       or p.id in (
         select d.user_id
           from public.trip_assignments ta
           join public.drivers d on d.id = ta.driver_id
          where ta.trip_id = p_trip_id and ta.status <> 'CANCELLED'
         union
         select a.user_id
           from public.trip_assignments ta
           join public.assistants a on a.id = ta.assistant_id
          where ta.trip_id = p_trip_id and ta.status <> 'CANCELLED'
       )
     );
$$;

revoke all on function public.sos_responder_ids(uuid) from public, anon, authenticated;

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
  v_user_id uuid := public.active_uid();
  v_trip_id uuid;
  v_incident public.sos_incidents%rowtype;
  v_name text;
  v_phone text;
  v_trip_label text;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- The trip is derived from the caller's own booking, never taken from the
  -- client. Without an explicit booking, the one they are most plausibly on
  -- right now: a trip under way before one that is not, a booking with
  -- someone aboard before one without, then the departure nearest to now.
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
      join public.trips t on t.id = b.trip_id
     where b.user_id = v_user_id
       and b.status in ('CONFIRMED', 'CHECKED_IN', 'BOARDED', 'ON_TRIP')
     order by
       (t.status in ('BOARDING', 'DEPARTED', 'ON_TRIP')) desc,
       (b.status in ('BOARDED', 'ON_TRIP')) desc,
       abs(extract(epoch from (t.departure_at - (now() at time zone 'Asia/Manila')))) asc
     limit 1;
  end if;

  begin
    insert into public.sos_incidents (user_id, booking_id, trip_id, latitude, longitude)
    values (v_user_id, p_booking_id, v_trip_id, p_latitude, p_longitude)
    returning * into v_incident;
  exception when unique_violation then
    -- Already have an open alert. Return it — a repeat tap is not a new
    -- emergency, and the responders were told the first time.
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

  -- The passenger is told what has happened, and nothing more.
  insert into public.notifications (user_id, type, title, message, data)
  values (
    v_user_id, 'SOS', 'Emergency alert sent',
    'Your location has been sent to the operator. You will see here when they respond. '
      || 'If you are in danger, call emergency services directly.',
    jsonb_build_object('sosId', v_incident.id)
  );

  -- Everyone who can act on it is told, with enough to act on. The
  -- notification insert fires the push webhook, so this reaches a phone in a
  -- pocket, not only an open console.
  select coalesce(nullif(trim(full_name), ''), email), phone
    into v_name, v_phone
    from public.profiles where id = v_user_id;

  select t.trip_number || ' · ' || b.bus_number
    into v_trip_label
    from public.trips t join public.buses b on b.id = t.bus_id
   where t.id = v_incident.trip_id;

  insert into public.notifications (user_id, type, title, message, data)
  select r.id, 'SOS',
         'EMERGENCY: ' || coalesce(v_trip_label, 'passenger not on a trip'),
         coalesce(v_name, 'A passenger') || coalesce(' (' || v_phone || ')', '')
           || ' raised an SOS at ' || round(p_latitude, 5) || ', ' || round(p_longitude, 5)
           || '. Acknowledge it in PalaGo.',
         jsonb_build_object('sosId', v_incident.id, 'tripId', v_incident.trip_id, 'responder', true)
    from public.sos_responder_ids(v_incident.trip_id) as r(id)
   where r.id <> v_user_id;

  return jsonb_build_object(
    'id', v_incident.id,
    'status', v_incident.status,
    'tripId', v_incident.trip_id,
    'createdAt', v_incident.created_at,
    'alreadyOpen', false
  );
end;
$$;

revoke all on function public.trigger_sos(numeric, numeric, uuid) from public, anon;
grant execute on function public.trigger_sos(numeric, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What a responder needs on screen. Owner-rights view with the filter inside,
-- the operator_* pattern: RLS on `profiles` would otherwise hide the very
-- name and phone number the responder needs, and widening `profiles` itself
-- would hand every operator every passenger's details. This shows them only
-- for incidents `can_manage_sos` already lets the caller act on.
-- ---------------------------------------------------------------------------

create or replace view public.sos_incident_details
with (security_barrier = true)
as
select
  s.id,
  s.user_id,
  s.booking_id,
  s.trip_id,
  s.latitude,
  s.longitude,
  s.status,
  s.note,
  s.created_at,
  s.acknowledged_at,
  s.responding_at,
  s.resolved_at,
  coalesce(nullif(trim(p.full_name), ''), p.email) as passenger_name,
  p.phone as passenger_phone,
  t.trip_number,
  t.departure_at,
  o.name as operator_name,
  bu.bus_number,
  ot.city || ' → ' || dt.city as route_label
from public.sos_incidents s
join public.profiles p on p.id = s.user_id
left join public.trips t on t.id = s.trip_id
left join public.operators o on o.id = t.operator_id
left join public.buses bu on bu.id = t.bus_id
left join public.routes r on r.id = t.route_id
left join public.terminals ot on ot.id = r.origin_terminal_id
left join public.terminals dt on dt.id = r.destination_terminal_id
where public.can_manage_sos(s.trip_id);

revoke all on public.sos_incident_details from public, anon;
grant select on public.sos_incident_details to authenticated;

comment on view public.sos_incident_details is
  'SOS incidents with the passenger''s name and phone, trip, coach and route — only for incidents the caller may act on (can_manage_sos). The responders'' view; passengers read their own rows from sos_incidents.';
