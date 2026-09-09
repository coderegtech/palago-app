-- Phase 10: wiring loyalty into the booking lifecycle.
--
-- Three existing functions grow a loyalty step. They are rewritten in full
-- rather than patched, because `create or replace function` has no partial
-- form — so the bodies below carry forward everything from Phases 5, 8 and 9
-- unchanged, with the loyalty lines added.
--
--   `end_trip`              awards points, once per booking, for trips taken
--   `cancel_booking`        returns points staked on a booking never paid for
--   `refund_test_payment`   returns points staked on a booking now refunded
--
-- The asymmetry is deliberate: points are EARNED only at completion, but
-- REDEEMED points are returned whenever the booking they were spent on stops
-- being a trip. A passenger who cancels must not be out of pocket in points
-- for a journey that never happened.

-- ---------------------------------------------------------------------------
-- end_trip — now awards points
-- ---------------------------------------------------------------------------

create or replace function public.end_trip(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
         actual_arrival_at = now()
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
$$;

-- ---------------------------------------------------------------------------
-- cancel_booking — now returns staked points
--
-- Body from 20260909000005 with the release added.
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
  v_points_returned integer := 0;
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
    return jsonb_build_object(
      'bookingId', v_booking.id, 'status', 'CANCELLED', 'pointsReturned', 0
    );
  end if;

  if v_booking.status not in ('PENDING', 'PAYMENT_PENDING') then
    raise exception 'BOOKING_ALREADY_CONFIRMED';
  end if;

  -- Before the status changes, while the booking is still payable, so the
  -- release also restores the total.
  v_points_returned := public.release_booking_redemption(p_booking_id);

  update public.bookings
     set status = 'CANCELLED', cancelled_at = now()
   where id = p_booking_id;

  update public.trip_seats
     set status = 'AVAILABLE', booking_id = null, held_by = null, held_until = null
   where booking_id = p_booking_id
     and status = 'HELD';

  return jsonb_build_object(
    'bookingId', v_booking.id,
    'status', 'CANCELLED',
    'pointsReturned', v_points_returned
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- refund_test_payment — now returns staked points too
--
-- Body from 20260909000017 (which added the wallet credit-back) with the
-- loyalty release added.
-- ---------------------------------------------------------------------------

create or replace function public.refund_test_payment(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_booking public.bookings%rowtype;
  v_payment public.payments%rowtype;
  v_wallet public.wallets%rowtype;
  v_charge public.wallet_transactions%rowtype;
  v_refunded_to_wallet boolean := false;
  v_points_returned integer := 0;
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

  select * into v_payment
    from public.payments
   where booking_id = p_booking_id and status in ('PAID', 'REFUNDED')
   limit 1;

  if not found then
    raise exception 'UNPAID_BOOKING';
  end if;

  if v_payment.status = 'REFUNDED' then
    return jsonb_build_object(
      'alreadyRefunded', true,
      'paymentReference', v_payment.reference,
      'bookingReference', v_booking.booking_reference,
      'amount', v_payment.amount,
      'refundedToWallet', exists (
        select 1 from public.wallet_transactions
        where payment_id = v_payment.id and type = 'REFUND'
      ),
      'pointsReturned', 0
    );
  end if;

  if v_booking.status in ('BOARDED', 'ON_TRIP', 'COMPLETED') then
    raise exception 'VALIDATION_ERROR';
  end if;

  update public.payments
     set status = 'REFUNDED', refunded_at = now()
   where id = v_payment.id;

  update public.bookings
     set status = 'REFUNDED', cancelled_at = now()
   where id = v_booking.id;

  update public.trip_seats
     set status = 'AVAILABLE', booking_id = null, held_by = null,
         held_until = null, confirmed_at = null
   where booking_id = v_booking.id;

  -- Was this paid from a wallet? If so, put it back. (Phase 9.)
  select * into v_charge
    from public.wallet_transactions
   where payment_id = v_payment.id and type = 'BOOKING_PAYMENT';

  if found then
    select * into v_wallet from public.wallets where id = v_charge.wallet_id for update;
    perform public.wallet_post(
      v_wallet.id, 'REFUND', -v_charge.amount, v_booking.booking_reference,
      'Refund for booking ' || v_booking.booking_reference || ' (test)',
      v_booking.id, v_payment.id, null
    );
    v_refunded_to_wallet := true;
  end if;

  -- Were points staked on it? Give them back. (Phase 10.) The booking is no
  -- longer payable at this point, so the release returns the points without
  -- rewriting the total the passenger was actually charged.
  v_points_returned := public.release_booking_redemption(p_booking_id);

  insert into public.payment_transactions (payment_id, type, amount, status, reference, metadata)
  values (
    v_payment.id, 'REFUNDED', v_payment.amount, 'REFUNDED', v_payment.reference,
    jsonb_build_object('provider', 'MOCK', 'toWallet', v_refunded_to_wallet,
                       'pointsReturned', v_points_returned,
                       'note', 'Test refund - no funds moved')
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id, 'TEST_PAYMENT_REFUNDED', 'payment', v_payment.id,
    jsonb_build_object('bookingId', v_booking.id, 'amount', v_payment.amount,
                       'toWallet', v_refunded_to_wallet,
                       'pointsReturned', v_points_returned)
  );

  insert into public.notifications (user_id, type, title, message, data)
  values (
    v_booking.user_id, 'SYSTEM', 'Booking refunded',
    case when v_refunded_to_wallet
      then 'Your booking ' || v_booking.booking_reference ||
           ' has been refunded to your test wallet.'
      else 'Your booking ' || v_booking.booking_reference || ' has been refunded (test).'
    end,
    jsonb_build_object('bookingId', v_booking.id, 'toWallet', v_refunded_to_wallet,
                       'pointsReturned', v_points_returned)
  );

  return jsonb_build_object(
    'alreadyRefunded', false,
    'paymentReference', v_payment.reference,
    'bookingReference', v_booking.booking_reference,
    'amount', v_payment.amount,
    'refundedToWallet', v_refunded_to_wallet,
    'pointsReturned', v_points_returned
  );
end;
$$;

revoke all on function public.end_trip(uuid) from public, anon;
revoke all on function public.cancel_booking(uuid) from public, anon;
revoke all on function public.refund_test_payment(uuid) from public, anon;
grant execute on function public.end_trip(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.refund_test_payment(uuid) to authenticated;
