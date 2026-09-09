-- Phase 4b: seat reservation, release and expiry.
--
-- Every function here is SECURITY DEFINER because `trip_seats` and `bookings`
-- grant no write privileges to clients at all. These are the only doors in.
--
-- Errors are raised with the message set to an exact code from
-- src/constants/errors.ts, so the client branches on a code rather than parsing
-- prose. See `mapRpcError` in src/services/booking-service.ts.

-- ---------------------------------------------------------------------------
-- reserve_seats
--
-- Signature note — this deviates from the original spec sketch
-- `reserve_seats(p_trip_id, p_seat_ids, p_user_id)`, deliberately:
--
--   * `p_user_id` is gone. The booking's owner comes from auth.uid(). Accepting
--     a user id from the caller would let anyone create bookings in someone
--     else's name, which no amount of client-side care could prevent.
--   * `p_seat_ids` is folded into `p_passengers`: each passenger carries its own
--     seatId. Two parallel arrays can disagree about length or order; one array
--     of objects cannot.
--
-- p_passengers: [{ "seatId": uuid, "name": text, "phone": text|null,
--                  "email": text|null, "type": passenger_type }]
-- ---------------------------------------------------------------------------

create or replace function public.reserve_seats(
  p_trip_id uuid,
  p_passengers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid := (select auth.uid());
  v_trip        public.trips%rowtype;
  v_seat_ids    uuid[];
  v_seat_count  integer;
  v_available   integer;
  v_valid_seats integer;
  v_booking_id  uuid;
  v_reference   text;
  v_subtotal    integer;
  v_expires_at  timestamptz;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if jsonb_typeof(p_passengers) <> 'array' or jsonb_array_length(p_passengers) = 0 then
    raise exception 'VALIDATION_ERROR';
  end if;

  select array_agg((p ->> 'seatId')::uuid)
    into v_seat_ids
    from jsonb_array_elements(p_passengers) as p;

  v_seat_count := array_length(v_seat_ids, 1);

  if v_seat_count > 10 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- Two passengers cannot be given the same seat.
  if (select count(distinct s) from unnest(v_seat_ids) as s) <> v_seat_count then
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

  -- -------------------------------------------------------------------------
  -- Lock FIRST, then check.
  --
  -- This ordering is the whole point of the function. A concurrent caller
  -- asking for any of the same seats blocks here until this transaction
  -- commits; because READ COMMITTED takes a fresh snapshot per statement, it
  -- then sees the seats as HELD and fails the availability check below.
  --
  -- Checking availability before taking the lock would let both callers read
  -- "AVAILABLE" and both proceed — the classic double-booking race.
  --
  -- ORDER BY is not decoration. Two callers requesting overlapping seat sets in
  -- opposite orders would otherwise each hold one row and wait on the other's,
  -- deadlocking; Postgres kills one at random with a message the client cannot
  -- interpret. Locking in a consistent order makes one caller simply wait.
  -- -------------------------------------------------------------------------
  perform 1
     from public.trip_seats
    where trip_id = p_trip_id
      and seat_id = any(v_seat_ids)
    order by seat_id
    for update;

  -- Every requested seat must actually belong to this trip.
  select count(*) into v_valid_seats
    from public.trip_seats
   where trip_id = p_trip_id and seat_id = any(v_seat_ids);

  if v_valid_seats <> v_seat_count then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- Reclaim holds that have already lapsed, so a stale hold does not make a
  -- seat look taken when the sweep simply has not run yet.
  update public.trip_seats
     set status = 'AVAILABLE', booking_id = null, held_by = null, held_until = null
   where trip_id = p_trip_id
     and seat_id = any(v_seat_ids)
     and status = 'HELD'
     and held_until < now();

  select count(*) into v_available
    from public.trip_seats
   where trip_id = p_trip_id
     and seat_id = any(v_seat_ids)
     and status = 'AVAILABLE';

  if v_available <> v_seat_count then
    raise exception 'SEAT_UNAVAILABLE';
  end if;

  -- -------------------------------------------------------------------------
  -- Price is computed here from the trip's own fare. Nothing about the amount
  -- comes from the caller.
  -- -------------------------------------------------------------------------
  v_subtotal   := v_trip.fare * v_seat_count;
  v_expires_at := now() + interval '10 minutes';
  v_reference  := public.next_booking_reference();

  insert into public.bookings (
    user_id, trip_id, booking_reference, status,
    subtotal, discount, loyalty_discount, total_amount, expires_at
  )
  values (
    v_user_id, p_trip_id, v_reference, 'PAYMENT_PENDING',
    v_subtotal, 0, 0, v_subtotal, v_expires_at
  )
  returning id into v_booking_id;

  insert into public.booking_passengers (
    booking_id, user_id, seat_id, passenger_name, phone, email, passenger_type
  )
  select
    v_booking_id,
    v_user_id,
    (p ->> 'seatId')::uuid,
    trim(p ->> 'name'),
    nullif(trim(coalesce(p ->> 'phone', '')), ''),
    nullif(trim(coalesce(p ->> 'email', '')), ''),
    coalesce(nullif(p ->> 'type', ''), 'ADULT')::public.passenger_type
  from jsonb_array_elements(p_passengers) as p;

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
    'discount', 0,
    'loyaltyDiscount', 0,
    'totalAmount', v_subtotal,
    'currency', 'PHP',
    'seatCount', v_seat_count,
    'expiresAt', v_expires_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_booking
--
-- For a passenger backing out before paying. Refunds and cancelling a paid
-- booking belong to Phase 5; this only handles a booking that never got that
-- far, and its job is to make sure the seats do not stay stuck.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_booking public.bookings%rowtype;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_booking.user_id <> v_user_id and not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  -- Idempotent: cancelling an already-cancelled booking is a no-op, not an
  -- error. A retried request after a dropped connection is normal.
  if v_booking.status = 'CANCELLED' then
    return jsonb_build_object('bookingId', v_booking.id, 'status', 'CANCELLED');
  end if;

  if v_booking.status not in ('PENDING', 'PAYMENT_PENDING') then
    raise exception 'BOOKING_ALREADY_CONFIRMED';
  end if;

  update public.bookings
     set status = 'CANCELLED', cancelled_at = now()
   where id = p_booking_id;

  update public.trip_seats
     set status = 'AVAILABLE', booking_id = null, held_by = null, held_until = null
   where booking_id = p_booking_id
     and status = 'HELD';

  return jsonb_build_object('bookingId', v_booking.id, 'status', 'CANCELLED');
end;
$$;

-- ---------------------------------------------------------------------------
-- expire_seat_holds
--
-- Sweeps bookings whose payment window has closed and returns their seats.
--
-- Deliberately NOT callable by ordinary users: it is a maintenance job for a
-- scheduled task or an Edge Function running with the service role. Expiry must
-- not depend on a client timer, which stops the moment the app is backgrounded.
-- ---------------------------------------------------------------------------

create or replace function public.expire_seat_holds()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bookings uuid[];
  v_seats integer;
begin
  select coalesce(array_agg(id), '{}')
    into v_bookings
    from public.bookings
   where status in ('PENDING', 'PAYMENT_PENDING')
     and expires_at is not null
     and expires_at < now();

  update public.bookings
     set status = 'CANCELLED', cancelled_at = now()
   where id = any(v_bookings);

  with released as (
    update public.trip_seats
       set status = 'AVAILABLE', booking_id = null, held_by = null, held_until = null
     where status = 'HELD'
       and (booking_id = any(v_bookings) or held_until < now())
    returning 1
  )
  select count(*) into v_seats from released;

  return jsonb_build_object(
    'cancelledBookings', coalesce(array_length(v_bookings, 1), 0),
    'releasedSeats', v_seats
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.reserve_seats(uuid, jsonb) from public, anon;
grant execute on function public.reserve_seats(uuid, jsonb) to authenticated;

revoke all on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated;

-- Maintenance only: service role, never a signed-in user.
revoke all on function public.expire_seat_holds() from public, anon, authenticated;
grant execute on function public.expire_seat_holds() to service_role;
