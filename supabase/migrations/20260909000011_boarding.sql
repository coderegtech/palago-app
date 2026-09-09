-- Phase 6: boarding.
--
-- The boarding QR is a DIFFERENT credential from the payment QR, issued only
-- once payment is confirmed. Conflating them would let an unpaid booking board.
--
-- The QR carries a token signed by an Edge Function secret; this schema does
-- not store it. Authenticity comes from the signature, and revocation comes
-- from the booking state checked here — a cancelled or refunded booking fails
-- validation no matter how valid its signature is.

create type public.scan_type as enum ('VALIDATION', 'BOARDING');

-- ---------------------------------------------------------------------------
-- Boarding timestamps
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column checked_in_at timestamptz,
  add column boarded_at timestamptz;

comment on column public.bookings.boarded_at is
  'Set once, by confirm_boarding. Its presence is what makes a second scan ALREADY_BOARDED.';

-- ---------------------------------------------------------------------------
-- Scan log
--
-- Every scan is recorded, including the failures. An operator disputing "the
-- app said invalid" needs the evidence, and a ticket scanned repeatedly at
-- different terminals is worth being able to see.
-- ---------------------------------------------------------------------------

create table public.qr_scans (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings (id) on delete set null,
  operator_user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete set null,
  scan_type public.scan_type not null,
  /** The ErrorCode, or 'VALID'. */
  result text not null,
  scanned_at timestamptz not null default now()
);

create index qr_scans_booking_id_idx on public.qr_scans (booking_id);
create index qr_scans_trip_id_idx on public.qr_scans (trip_id, scanned_at desc);
create index qr_scans_operator_idx on public.qr_scans (operator_user_id, scanned_at desc);

-- ---------------------------------------------------------------------------
-- Who may scan
--
-- An operator's own staff, or an admin. A passenger must never be able to
-- validate or board a ticket, including their own.
-- ---------------------------------------------------------------------------

create or replace function public.can_scan_trip(p_trip_id uuid)
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
        and public.current_profile_role() in ('OPERATOR', 'DRIVER', 'ASSISTANT')
    );
$$;

-- ---------------------------------------------------------------------------
-- validate_booking_qr
--
-- Read-only apart from the scan log. Returns a result code rather than raising,
-- because "this ticket is not valid" is an ANSWER the scanner must display, not
-- an error — the operator needs to know which of the several reasons applies.
--
-- Signature verification happens in the Edge Function, which holds the secret.
-- By the time this runs, the token is known to be authentic; what remains is
-- whether the booking is actually good to board.
-- ---------------------------------------------------------------------------

create or replace function public.validate_booking_qr(
  p_booking_id uuid,
  p_reference text,
  p_expected_trip_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scanner uuid := (select auth.uid());
  v_booking public.bookings%rowtype;
  v_result text;
  v_payload jsonb;
begin
  if v_scanner is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;

  if not found or v_booking.booking_reference <> p_reference then
    -- Logged without a booking id: something was scanned, and it was not ours.
    insert into public.qr_scans (operator_user_id, scan_type, result)
    values (v_scanner, 'VALIDATION', 'INVALID_QR');
    return jsonb_build_object('result', 'INVALID_QR', 'valid', false);
  end if;

  if not public.can_scan_trip(v_booking.trip_id) then
    raise exception 'FORBIDDEN';
  end if;

  -- Checked in order of what an operator most needs to know first.
  v_result :=
    case
      when v_booking.status in ('CANCELLED', 'REFUNDED') then 'INVALID_QR'
      when v_booking.status = 'BOARDED' then 'ALREADY_BOARDED'
      when v_booking.status in ('ON_TRIP', 'COMPLETED') then 'ALREADY_BOARDED'
      when v_booking.status = 'PAYMENT_PENDING' or v_booking.status = 'PENDING'
        then 'UNPAID_BOOKING'
      when not exists (
        select 1 from public.payments p
        where p.booking_id = v_booking.id and p.status = 'PAID'
      ) then 'UNPAID_BOOKING'
      when p_expected_trip_id is not null and v_booking.trip_id <> p_expected_trip_id
        then 'WRONG_TRIP'
      when v_booking.status not in ('CONFIRMED', 'CHECKED_IN') then 'INVALID_QR'
      else 'VALID'
    end;

  insert into public.qr_scans (booking_id, operator_user_id, trip_id, scan_type, result)
  values (v_booking.id, v_scanner, v_booking.trip_id, 'VALIDATION', v_result);

  -- The passenger detail an operator needs at the door, and nothing more.
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
    'paymentStatus', coalesce(
      (select p.status::text from public.payments p
        where p.booking_id = v_booking.id
        order by case when p.status = 'PAID' then 0 else 1 end limit 1),
      'NONE'
    ),
    'passengers', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', bp.passenger_name,
               'seat', bs.seat_number,
               'type', bp.passenger_type
             ) order by bs.seat_number), '[]'::jsonb)
        from public.booking_passengers bp
        join public.bus_seats bs on bs.id = bp.seat_id
       where bp.booking_id = v_booking.id
    )
  )
  into v_payload
  from public.trips t
  join public.operators o on o.id = t.operator_id
  join public.routes r on r.id = t.route_id
  join public.terminals ot on ot.id = r.origin_terminal_id
  join public.terminals dt on dt.id = r.destination_terminal_id
  where t.id = v_booking.trip_id;

  return v_payload;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_boarding
--
-- CONFIRMED (or CHECKED_IN) -> BOARDED, once.
--
-- The status transition IS the duplicate-scan protection: it is guarded by a
-- row lock and a status precondition, so two operators scanning the same ticket
-- at the same moment cannot both board it. The first wins; the second is told
-- ALREADY_BOARDED.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_boarding(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scanner uuid := (select auth.uid());
  v_booking public.bookings%rowtype;
begin
  if v_scanner is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if not public.can_scan_trip(v_booking.trip_id) then
    raise exception 'FORBIDDEN';
  end if;

  -- Idempotent for the operator who already boarded this passenger, and a
  -- clear refusal for anyone scanning it a second time.
  if v_booking.status in ('BOARDED', 'ON_TRIP', 'COMPLETED') then
    insert into public.qr_scans (booking_id, operator_user_id, trip_id, scan_type, result)
    values (v_booking.id, v_scanner, v_booking.trip_id, 'BOARDING', 'ALREADY_BOARDED');

    return jsonb_build_object(
      'boarded', false,
      'alreadyBoarded', true,
      'result', 'ALREADY_BOARDED',
      'bookingReference', v_booking.booking_reference,
      'boardedAt', v_booking.boarded_at
    );
  end if;

  if v_booking.status in ('CANCELLED', 'REFUNDED') then
    insert into public.qr_scans (booking_id, operator_user_id, trip_id, scan_type, result)
    values (v_booking.id, v_scanner, v_booking.trip_id, 'BOARDING', 'INVALID_QR');
    raise exception 'INVALID_QR';
  end if;

  if v_booking.status not in ('CONFIRMED', 'CHECKED_IN') then
    insert into public.qr_scans (booking_id, operator_user_id, trip_id, scan_type, result)
    values (v_booking.id, v_scanner, v_booking.trip_id, 'BOARDING', 'UNPAID_BOOKING');
    raise exception 'UNPAID_BOOKING';
  end if;

  -- Belt and braces: the status should already imply this, but boarding an
  -- unpaid passenger is the failure worth checking twice.
  if not exists (
    select 1 from public.payments p
    where p.booking_id = v_booking.id and p.status = 'PAID'
  ) then
    insert into public.qr_scans (booking_id, operator_user_id, trip_id, scan_type, result)
    values (v_booking.id, v_scanner, v_booking.trip_id, 'BOARDING', 'UNPAID_BOOKING');
    raise exception 'UNPAID_BOOKING';
  end if;

  update public.bookings
     set status = 'BOARDED',
         checked_in_at = coalesce(checked_in_at, now()),
         boarded_at = now()
   where id = v_booking.id;

  insert into public.qr_scans (booking_id, operator_user_id, trip_id, scan_type, result)
  values (v_booking.id, v_scanner, v_booking.trip_id, 'BOARDING', 'VALID');

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_scanner, 'BOARDING_CONFIRMED', 'booking', v_booking.id,
    jsonb_build_object(
      'bookingReference', v_booking.booking_reference,
      'tripId', v_booking.trip_id
    )
  );

  insert into public.notifications (user_id, type, title, message, data)
  values (
    v_booking.user_id, 'BOARDING', 'You have boarded',
    'Boarding confirmed for ' || v_booking.booking_reference || '. Have a safe trip.',
    jsonb_build_object('bookingId', v_booking.id)
  );

  return jsonb_build_object(
    'boarded', true,
    'alreadyBoarded', false,
    'result', 'VALID',
    'bookingReference', v_booking.booking_reference,
    'boardedAt', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.qr_scans enable row level security;

create policy "Operators read scans for their own trips"
  on public.qr_scans for select to authenticated
  using (
    public.is_admin()
    or operator_user_id = (select auth.uid())
    or exists (
      select 1 from public.trips t
      where t.id = trip_id and t.operator_id = public.current_operator_id()
    )
  );

-- Scan rows are written only by the functions above.
revoke insert, update, delete on public.qr_scans from anon, authenticated;

revoke all on function public.validate_booking_qr(uuid, text, uuid) from public, anon;
grant execute on function public.validate_booking_qr(uuid, text, uuid) to authenticated;

revoke all on function public.confirm_boarding(uuid) from public, anon;
grant execute on function public.confirm_boarding(uuid) to authenticated;

revoke all on function public.can_scan_trip(uuid) from public, anon;
grant execute on function public.can_scan_trip(uuid) to authenticated;
