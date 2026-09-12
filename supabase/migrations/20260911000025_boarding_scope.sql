-- Boarding scope: a ticket is checked against the trip actually being boarded.
--
-- Until now the scanner never said which trip it was boarding.
-- `validate_booking_qr` only looked for a wrong trip when handed an optional
-- expected trip, neither scanner sent one, and `confirm_boarding` had no trip
-- check at all — nor any check that boarding had opened. Combined with
-- `can_scan_trip` letting any driver or assistant of an operator scan any of
-- its trips, a Cherry driver at Thursday's 08:00 PPS→ELN door could board a
-- ticket for Friday's PPS→RXS trip. The booking became BOARDED, so on Friday
-- the right bus answered ALREADY_BOARDED and turned the passenger away.
--
-- Now:
--   * both functions require the trip being boarded (the "door");
--   * nothing boards unless that trip is BOARDING;
--   * a ticket for another trip is refused with the most useful reason —
--     WRONG_ROUTE, WRONG_DATE or WRONG_BUS for the same operator, and a bare
--     WRONG_TRIP (no details) for a rival's ticket;
--   * crew may scan only trips they crew; operator managers, any of theirs;
--   * boarding is per passenger, so a family booking where one person does not
--     turn up is recorded truthfully;
--   * every scan — refused ones included — is logged with the door's trip, its
--     bus, and how the ticket was presented. Refusals used to `raise` after
--     writing the scan row, which rolled the row back; they are now returned.
--
-- One verdict function serves both validation and boarding, so the screen's
-- "VALID" and the database's decision to board cannot drift apart.

create type public.scan_method as enum ('QR', 'REFERENCE', 'MANUAL');

-- ---------------------------------------------------------------------------
-- Scan log: where, on which bus, and how
-- ---------------------------------------------------------------------------

alter table public.qr_scans
  add column ticket_trip_id uuid references public.trips (id) on delete set null,
  add column bus_id uuid references public.buses (id) on delete set null,
  add column scan_method public.scan_method not null default 'QR';

comment on column public.qr_scans.trip_id is
  'The trip being boarded — the door the scan was made at.';
comment on column public.qr_scans.ticket_trip_id is
  'The trip on the ticket. Differs from trip_id only for WRONG_* results.';
comment on column public.qr_scans.bus_id is
  'The bus assigned to the door''s trip at the moment of the scan.';

-- Before this migration the only trip recorded was the ticket's, and every
-- logged scan was made against it, so the two are the same for history.
update public.qr_scans s
   set ticket_trip_id = s.trip_id,
       bus_id = t.bus_id
  from public.trips t
 where t.id = s.trip_id;

-- ---------------------------------------------------------------------------
-- Per-passenger boarding
-- ---------------------------------------------------------------------------

alter table public.booking_passengers
  add column boarded_at timestamptz,
  add column boarded_by uuid references auth.users (id) on delete set null,
  add constraint booking_passengers_boarded_by_needs_time
    check (boarded_by is null or boarded_at is not null);

comment on column public.booking_passengers.boarded_at is
  'When this passenger boarded. Null until then — a booking can be partly boarded.';

-- Boarding used to be all-or-nothing, so every passenger on a boarded booking
-- boarded at the booking's time, and the scanner is the successful BOARDING scan.
update public.booking_passengers bp
   set boarded_at = b.boarded_at,
       boarded_by = (
         select s.operator_user_id from public.qr_scans s
          where s.booking_id = b.id and s.scan_type = 'BOARDING' and s.result = 'VALID'
          order by s.scanned_at
          limit 1
       )
  from public.bookings b
 where b.id = bp.booking_id
   and b.boarded_at is not null;

-- ---------------------------------------------------------------------------
-- can_scan_trip: managers scan their operator's trips; crew scan their own
--
-- Crew are matched by any non-cancelled assignment — "were you the crew", not
-- "are you still on duty" (see AGENTS.md on end_trip). Assignments themselves
-- are only writable by operator managers since 20260911000024.
-- ---------------------------------------------------------------------------

create or replace function public.can_scan_trip(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(public.is_admin(), false)
    or public.can_manage_operator((select t.operator_id from public.trips t where t.id = p_trip_id))
    or exists (
      select 1 from public.trip_assignments ta
      where ta.trip_id = p_trip_id
        and ta.status <> 'CANCELLED'
        and (
          ta.driver_id = public.current_driver_id()
          or ta.assistant_id = public.current_assistant_id()
        )
    );
$$;

-- ---------------------------------------------------------------------------
-- boarding_verdict — the one answer to "may this ticket board at this door?"
--
-- Internal: called only by the two functions below, which have already
-- authenticated the caller and authorised them for the door.
-- ---------------------------------------------------------------------------

create or replace function public.boarding_verdict(
  p_booking public.bookings,
  p_door public.trips
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ticket public.trips%rowtype;
begin
  -- The door first. Nothing boards a trip that has not opened boarding, or one
  -- that has already left.
  if p_door.status = 'SCHEDULED' then
    return 'BOARDING_NOT_OPEN';
  elsif p_door.status <> 'BOARDING' then
    return 'BOARDING_CLOSED';
  end if;

  -- Then whether this is even the right bus, most specific reason first.
  if p_booking.trip_id <> p_door.id then
    select * into v_ticket from public.trips where id = p_booking.trip_id;
    if v_ticket.operator_id is distinct from p_door.operator_id then
      return 'WRONG_TRIP';
    elsif v_ticket.route_id <> p_door.route_id then
      return 'WRONG_ROUTE';
    elsif v_ticket.departure_date <> p_door.departure_date then
      return 'WRONG_DATE';
    else
      return 'WRONG_BUS';
    end if;
  end if;

  if p_booking.status in ('CANCELLED', 'REFUNDED') then
    return 'BOOKING_CANCELLED';
  end if;

  if not exists (
    select 1 from public.booking_passengers bp
    where bp.booking_id = p_booking.id and bp.boarded_at is null
  ) then
    return 'ALREADY_BOARDED';
  end if;

  if p_booking.status in ('PENDING', 'PAYMENT_PENDING')
     or not exists (
       select 1 from public.payments p
       where p.booking_id = p_booking.id and p.status = 'PAID'
     ) then
    return 'UNPAID_BOOKING';
  end if;

  -- BOARDED stays eligible: it means someone on the booking has boarded, and
  -- the rest may follow.
  if p_booking.status not in ('CONFIRMED', 'CHECKED_IN', 'BOARDED') then
    return 'INVALID_QR';
  end if;

  return 'VALID';
end;
$$;

revoke all on function public.boarding_verdict(public.bookings, public.trips) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- validate_booking_qr — read the ticket at this door, change nothing
--
-- The old signature took an optional expected trip. Dropped, not overloaded: an
-- old unscoped version left in place would still be callable over RPC.
-- ---------------------------------------------------------------------------

drop function public.validate_booking_qr(uuid, text, uuid);

create function public.validate_booking_qr(
  p_booking_id uuid,
  p_reference text,
  p_trip_id uuid,
  p_method public.scan_method default 'QR'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scanner uuid := (select auth.uid());
  v_door public.trips%rowtype;
  v_booking public.bookings%rowtype;
  v_result text;
  v_payload jsonb;
begin
  if v_scanner is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_trip_id is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_door from public.trips where id = p_trip_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if not public.can_scan_trip(v_door.id) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;

  if not found or v_booking.booking_reference <> p_reference then
    -- Something was scanned, and it was not ours.
    insert into public.qr_scans (operator_user_id, trip_id, bus_id, scan_type, scan_method, result)
    values (v_scanner, v_door.id, v_door.bus_id, 'VALIDATION', p_method, 'INVALID_QR');
    return jsonb_build_object('result', 'INVALID_QR', 'valid', false);
  end if;

  v_result := public.boarding_verdict(v_booking, v_door);

  insert into public.qr_scans (
    booking_id, operator_user_id, trip_id, ticket_trip_id, bus_id, scan_type, scan_method, result
  )
  values (
    v_booking.id, v_scanner, v_door.id, v_booking.trip_id, v_door.bus_id,
    'VALIDATION', p_method, v_result
  );

  -- A rival operator's ticket: say so, and nothing else about it.
  if not exists (
    select 1 from public.trips t
    where t.id = v_booking.trip_id and t.operator_id = v_door.operator_id
  ) then
    return jsonb_build_object('result', v_result, 'valid', false);
  end if;

  -- The ticket's own trip is described, so an operator can send someone to the
  -- right bus. Passengers are listed only for this door's own tickets.
  select jsonb_build_object(
    'result', v_result,
    'valid', v_result = 'VALID',
    'bookingId', v_booking.id,
    'bookingReference', v_booking.booking_reference,
    'bookingStatus', v_booking.status,
    'boardedAt', v_booking.boarded_at,
    'operatorName', o.name,
    'tripNumber', t.trip_number,
    'tripId', t.id,
    'departureDate', t.departure_date,
    'departureTime', t.departure_time,
    'originCode', ot.code,
    'originName', ot.name,
    'destinationCode', dt.code,
    'destinationName', dt.name,
    'busNumber', b.bus_number,
    'paymentStatus', coalesce(
      (select p.status::text from public.payments p
        where p.booking_id = v_booking.id
        order by case when p.status = 'PAID' then 0 else 1 end limit 1),
      'NONE'
    ),
    'passengers', case when v_booking.trip_id = v_door.id then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', bp.id,
               'name', bp.passenger_name,
               'seat', bs.seat_number,
               'type', bp.passenger_type,
               'boardedAt', bp.boarded_at
             ) order by bs.seat_number), '[]'::jsonb)
        from public.booking_passengers bp
        join public.bus_seats bs on bs.id = bp.seat_id
       where bp.booking_id = v_booking.id
    ) else '[]'::jsonb end
  )
  into v_payload
  from public.trips t
  join public.operators o on o.id = t.operator_id
  join public.buses b on b.id = t.bus_id
  join public.routes r on r.id = t.route_id
  join public.terminals ot on ot.id = r.origin_terminal_id
  join public.terminals dt on dt.id = r.destination_terminal_id
  where t.id = v_booking.trip_id;

  return v_payload;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_boarding — board passengers of this booking at this door
--
-- p_passenger_ids null means everyone not yet boarded. The door's trip is
-- locked FOR SHARE first, then the booking FOR UPDATE — the same order
-- start_trip takes them — so a departure cannot land half-way through a
-- boarding, and two scans of one ticket board it once.
-- ---------------------------------------------------------------------------

drop function public.confirm_boarding(uuid);

create function public.confirm_boarding(
  p_booking_id uuid,
  p_trip_id uuid,
  p_passenger_ids uuid[] default null,
  p_method public.scan_method default 'QR'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scanner uuid := (select auth.uid());
  v_door public.trips%rowtype;
  v_booking public.bookings%rowtype;
  v_result text;
  v_boarded uuid[];
  v_remaining integer;
  v_same_operator boolean;
begin
  if v_scanner is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_trip_id is null
     or (p_passenger_ids is not null and cardinality(p_passenger_ids) = 0) then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_door from public.trips where id = p_trip_id for share;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if not public.can_scan_trip(v_door.id) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  -- Named passengers must be on this booking.
  if p_passenger_ids is not null and exists (
    select unnest(p_passenger_ids)
    except
    select bp.id from public.booking_passengers bp where bp.booking_id = v_booking.id
  ) then
    raise exception 'VALIDATION_ERROR';
  end if;

  v_result := public.boarding_verdict(v_booking, v_door);

  if v_result = 'VALID' then
    with boarded as (
      update public.booking_passengers bp
         set boarded_at = now(), boarded_by = v_scanner
       where bp.booking_id = v_booking.id
         and bp.boarded_at is null
         and (p_passenger_ids is null or bp.id = any (p_passenger_ids))
      returning bp.id
    )
    select array_agg(id) into v_boarded from boarded;

    -- Everyone named had already boarded.
    if v_boarded is null then
      v_result := 'ALREADY_BOARDED';
    end if;
  end if;

  insert into public.qr_scans (
    booking_id, operator_user_id, trip_id, ticket_trip_id, bus_id, scan_type, scan_method, result
  )
  values (
    v_booking.id, v_scanner, v_door.id, v_booking.trip_id, v_door.bus_id,
    'BOARDING', p_method, v_result
  );

  if v_result <> 'VALID' then
    select exists (
      select 1 from public.trips t
      where t.id = v_booking.trip_id and t.operator_id = v_door.operator_id
    ) into v_same_operator;

    return jsonb_build_object(
      'boarded', false,
      'alreadyBoarded', v_result = 'ALREADY_BOARDED',
      'result', v_result,
      'bookingReference', case when v_same_operator then v_booking.booking_reference end,
      'boardedAt', case when v_same_operator then v_booking.boarded_at end
    );
  end if;

  update public.bookings
     set status = 'BOARDED',
         checked_in_at = coalesce(checked_in_at, now()),
         boarded_at = coalesce(boarded_at, now())
   where id = v_booking.id;

  select count(*) into v_remaining
    from public.booking_passengers bp
   where bp.booking_id = v_booking.id and bp.boarded_at is null;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_scanner, 'BOARDING_CONFIRMED', 'booking', v_booking.id,
    jsonb_build_object(
      'bookingReference', v_booking.booking_reference,
      'tripId', v_door.id,
      'busId', v_door.bus_id,
      'method', p_method,
      'passengerIds', to_jsonb(v_boarded),
      'remaining', v_remaining
    )
  );

  -- Walk-in bookings (coming with assisted booking) have no account to notify.
  if v_booking.user_id is not null then
    insert into public.notifications (user_id, type, title, message, data)
    values (
      v_booking.user_id, 'BOARDING', 'You have boarded',
      case
        when v_remaining = 0
          then 'Boarding confirmed for ' || v_booking.booking_reference || '. Have a safe trip.'
        else cardinality(v_boarded) || ' passenger(s) on ' || v_booking.booking_reference
             || ' boarded. ' || v_remaining || ' still to board.'
      end,
      jsonb_build_object('bookingId', v_booking.id)
    );
  end if;

  return jsonb_build_object(
    'boarded', true,
    'alreadyBoarded', false,
    'result', 'VALID',
    'bookingReference', v_booking.booking_reference,
    'boardedAt', now(),
    'boardedPassengers', cardinality(v_boarded),
    'remaining', v_remaining
  );
end;
$$;

revoke all on function public.validate_booking_qr(uuid, text, uuid, public.scan_method) from public, anon;
grant execute on function public.validate_booking_qr(uuid, text, uuid, public.scan_method) to authenticated;

revoke all on function public.confirm_boarding(uuid, uuid, uuid[], public.scan_method) from public, anon;
grant execute on function public.confirm_boarding(uuid, uuid, uuid[], public.scan_method) to authenticated;

-- ---------------------------------------------------------------------------
-- The views that count or list boarding now read it per passenger. Each is the
-- latest definition verbatim, with only the boarded expression changed.
-- ---------------------------------------------------------------------------

-- operator_manifest: from 20260909000012_operator_views.sql, with boarding read per passenger.
create or replace view public.operator_manifest with (security_invoker = true) as
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
  bp.boarded_at,
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

-- operator_trip_overview: from 20260909000015_on_time.sql, with boarding read per passenger.
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
    where bk.trip_id = t.id and bp.boarded_at is not null and bk.status in ('BOARDED', 'ON_TRIP', 'COMPLETED')
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

-- driver_assignments: from 20260909000014_tracking.sql, with boarding read per passenger.
create or replace view public.driver_assignments with (security_invoker = true) as
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
    where bk.trip_id = t.id and bp.boarded_at is not null and bk.status in ('BOARDED', 'ON_TRIP', 'COMPLETED')
  )::int                   as boarded_count
from public.trip_assignments ta
join public.trips t on t.id = ta.trip_id
join public.buses b on b.id = t.bus_id
join public.routes r on r.id = t.route_id
join public.terminals o on o.id = r.origin_terminal_id
join public.terminals d on d.id = r.destination_terminal_id
where ta.driver_id = public.current_driver_id()
   or ta.assistant_id = public.current_assistant_id();
