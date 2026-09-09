-- Phase 5b: the payment state machine.
--
-- These functions are the only way payment or booking status ever changes.
-- Clients have no write privilege on `payments`, `bookings`, `receipts` or
-- `trip_seats`, so there is no second path to keep consistent.
--
-- Errors are raised with the message set to an exact code from
-- src/constants/errors.ts, matching the convention in reserve_seats.
--
-- MOCK ONLY: no function here contacts a payment provider. "Confirming" is a
-- state transition, nothing more. The full flow around it — records, server
-- validation, receipts, audit, notification — is real so that swapping in a
-- provider later is a contained change.

-- ---------------------------------------------------------------------------
-- create_test_payment
--
-- Called by the booking owner. Returns the reference and the QR token; the
-- Edge Function composes the payment URL, because only it knows the public web
-- base address.
--
-- Idempotent: asking twice for the same booking returns the existing live
-- payment rather than creating a second one. The partial unique index would
-- reject the duplicate anyway; this turns a constraint violation into the
-- sensible answer.
-- ---------------------------------------------------------------------------

create or replace function public.create_test_payment(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_booking public.bookings%rowtype;
  v_expected integer;
  v_payment public.payments%rowtype;
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

  -- Return the live payment if one already exists, whatever its state.
  select * into v_payment
    from public.payments
   where booking_id = p_booking_id
     and status in ('PENDING', 'PROCESSING', 'PAID')
   limit 1;

  if found then
    return jsonb_build_object(
      'paymentId', v_payment.id,
      'reference', v_payment.reference,
      'token', v_payment.token,
      'amount', v_payment.amount,
      'currency', v_payment.currency,
      'status', v_payment.status,
      'expiresAt', v_payment.expires_at,
      'reused', true
    );
  end if;

  if v_booking.status <> 'PAYMENT_PENDING' then
    raise exception 'BOOKING_ALREADY_CONFIRMED';
  end if;

  if v_booking.expires_at is not null and v_booking.expires_at < now() then
    raise exception 'BOOKING_EXPIRED';
  end if;

  -- Recomputed from the booking rather than accepted from the caller. The
  -- booking's own total was itself computed by reserve_seats from the trip fare.
  select total_amount into v_expected from public.bookings where id = p_booking_id;

  insert into public.payments (booking_id, amount, currency, status, expires_at)
  values (p_booking_id, v_expected, v_booking.currency, 'PENDING', v_booking.expires_at)
  returning * into v_payment;

  insert into public.payment_transactions (payment_id, type, amount, status, reference)
  values (v_payment.id, 'CREATED', v_payment.amount, 'PENDING', v_payment.reference);

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id, 'PAYMENT_CREATED', 'payment', v_payment.id,
    jsonb_build_object('bookingId', p_booking_id, 'amount', v_payment.amount, 'provider', 'MOCK')
  );

  return jsonb_build_object(
    'paymentId', v_payment.id,
    'reference', v_payment.reference,
    'token', v_payment.token,
    'amount', v_payment.amount,
    'currency', v_payment.currency,
    'status', v_payment.status,
    'expiresAt', v_payment.expires_at,
    'reused', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- get_public_payment
--
-- Backs the public payment page, which has no session. Authorisation is
-- possession of the token.
--
-- Returns only what the page needs to show. Deliberately absent: the token
-- itself, user ids, and anything about other bookings. A wrong token returns
-- NOT_FOUND rather than "bad token", so the reference cannot be probed.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_payment(p_reference text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_result jsonb;
begin
  select * into v_payment
    from public.payments
   where reference = p_reference
     and token = p_token;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  select jsonb_build_object(
    'paymentReference', v_payment.reference,
    'paymentStatus', v_payment.status,
    'provider', v_payment.provider,
    'amount', v_payment.amount,
    'currency', v_payment.currency,
    'expiresAt', v_payment.expires_at,
    'paidAt', v_payment.paid_at,
    'isExpired', (
      v_payment.status = 'PENDING'
      and v_payment.expires_at is not null
      and v_payment.expires_at < now()
    ),
    'bookingReference', b.booking_reference,
    'bookingStatus', b.status,
    'subtotal', b.subtotal,
    'discount', b.discount,
    'loyaltyDiscount', b.loyalty_discount,
    'totalAmount', b.total_amount,
    'operatorName', o.name,
    'tripNumber', t.trip_number,
    'departureDate', t.departure_date,
    'departureTime', t.departure_time,
    'originName', ot.name,
    'originCode', ot.code,
    'destinationName', dt.name,
    'destinationCode', dt.code,
    'passengers', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', bp.passenger_name,
               'seat', bs.seat_number,
               'type', bp.passenger_type
             ) order by bs.seat_number), '[]'::jsonb)
        from public.booking_passengers bp
        join public.bus_seats bs on bs.id = bp.seat_id
       where bp.booking_id = b.id
    ),
    'receipt', (
      select case when r.id is null then null else jsonb_build_object(
               'receiptNumber', r.receipt_number,
               'amount', r.amount,
               'currency', r.currency,
               'paymentMethod', r.payment_method,
               'issuedAt', r.issued_at
             ) end
        from public.receipts r where r.payment_id = v_payment.id
    )
  )
  into v_result
  from public.bookings b
  join public.trips t on t.id = b.trip_id
  join public.operators o on o.id = t.operator_id
  join public.routes rt on rt.id = t.route_id
  join public.terminals ot on ot.id = rt.origin_terminal_id
  join public.terminals dt on dt.id = rt.destination_terminal_id
  where b.id = v_payment.booking_id;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_test_payment
--
-- The whole confirmation, in one transaction: payment PAID, receipt issued,
-- booking CONFIRMED, seats moved HELD -> BOOKED, ledger row, audit entry,
-- notification.
--
-- IDEMPOTENT BY DESIGN. Calling it five times must leave one payment, one
-- receipt and one confirmation. A retry after a dropped connection is normal
-- on a Palawan mobile network, so a second call returns the existing receipt
-- with `alreadyConfirmed: true` rather than raising — the caller gets the same
-- answer, and the page can word itself accordingly.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_test_payment(
  p_reference text,
  p_token text,
  p_ip_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_booking public.bookings%rowtype;
  v_receipt public.receipts%rowtype;
  v_expected integer;
begin
  -- Lock the payment first. Two simultaneous confirmations serialise here, and
  -- the second sees status PAID and takes the idempotent path below.
  select * into v_payment
    from public.payments
   where reference = p_reference
     and token = p_token
   for update;

  if not found then
    raise exception 'INVALID_QR';
  end if;

  select * into v_booking from public.bookings where id = v_payment.booking_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  -- Already done: return the existing receipt rather than issuing another.
  if v_payment.status = 'PAID' then
    select * into v_receipt from public.receipts where payment_id = v_payment.id;
    return jsonb_build_object(
      'alreadyConfirmed', true,
      'paymentReference', v_payment.reference,
      'paymentStatus', v_payment.status,
      'bookingReference', v_booking.booking_reference,
      'bookingStatus', v_booking.status,
      'receiptNumber', v_receipt.receipt_number,
      'amount', v_receipt.amount,
      'currency', v_receipt.currency,
      'paidAt', v_payment.paid_at,
      'issuedAt', v_receipt.issued_at
    );
  end if;

  if v_payment.status = 'CANCELLED' then
    raise exception 'PAYMENT_EXPIRED';
  end if;

  if v_payment.status <> 'PENDING' then
    raise exception 'VALIDATION_ERROR';
  end if;

  if v_booking.status = 'CANCELLED' then
    raise exception 'BOOKING_EXPIRED';
  end if;

  if v_booking.status <> 'PAYMENT_PENDING' then
    raise exception 'BOOKING_ALREADY_CONFIRMED';
  end if;

  if v_payment.expires_at is not null and v_payment.expires_at < now() then
    raise exception 'PAYMENT_EXPIRED';
  end if;

  if v_booking.expires_at is not null and v_booking.expires_at < now() then
    raise exception 'BOOKING_EXPIRED';
  end if;

  -- The amount is re-derived and compared, not trusted. If a booking total ever
  -- drifted from the payment it was created for, refuse rather than guess.
  select total_amount into v_expected from public.bookings where id = v_booking.id;
  if v_payment.amount <> v_expected then
    raise exception 'VALIDATION_ERROR';
  end if;

  update public.payments
     set status = 'PAID', paid_at = now()
   where id = v_payment.id;

  insert into public.receipts (payment_id, booking_id, amount, currency, payment_method, status)
  values (v_payment.id, v_booking.id, v_payment.amount, v_payment.currency, 'TEST PAYMENT', 'PAID')
  returning * into v_receipt;

  update public.payments
     set receipt_number = v_receipt.receipt_number
   where id = v_payment.id;

  update public.bookings
     set status = 'CONFIRMED', confirmed_at = now(), expires_at = null
   where id = v_booking.id;

  -- The seats stop being a hold and become the passenger's.
  update public.trip_seats
     set status = 'BOOKED', confirmed_at = now(), held_until = null
   where booking_id = v_booking.id;

  insert into public.payment_transactions (payment_id, type, amount, status, reference, metadata)
  values (
    v_payment.id, 'PAID', v_payment.amount, 'PAID', v_receipt.receipt_number,
    jsonb_build_object('provider', 'MOCK', 'note', 'Test payment - no funds moved')
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
  values (
    v_booking.user_id, 'TEST_PAYMENT_CONFIRMED', 'payment', v_payment.id,
    jsonb_build_object(
      'bookingId', v_booking.id,
      'bookingReference', v_booking.booking_reference,
      'receiptNumber', v_receipt.receipt_number,
      'amount', v_payment.amount
    ),
    p_ip_address
  );

  insert into public.notifications (user_id, type, title, message, data)
  values (
    v_booking.user_id,
    'PAYMENT_CONFIRMED',
    'Test payment confirmed',
    'Your PalaGo booking ' || v_booking.booking_reference || ' is confirmed.',
    jsonb_build_object(
      'bookingId', v_booking.id,
      'bookingReference', v_booking.booking_reference,
      'receiptNumber', v_receipt.receipt_number
    )
  );

  return jsonb_build_object(
    'alreadyConfirmed', false,
    'paymentReference', v_payment.reference,
    'paymentStatus', 'PAID',
    'bookingReference', v_booking.booking_reference,
    'bookingStatus', 'CONFIRMED',
    'receiptNumber', v_receipt.receipt_number,
    'amount', v_receipt.amount,
    'currency', v_receipt.currency,
    'paidAt', now(),
    'issuedAt', v_receipt.issued_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- refund_test_payment
--
-- A MOCK refund: it records the reversal and releases the seats. No money moves,
-- because none ever did.
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

  -- Idempotent, like confirmation.
  if v_payment.status = 'REFUNDED' then
    return jsonb_build_object(
      'alreadyRefunded', true,
      'paymentReference', v_payment.reference,
      'bookingReference', v_booking.booking_reference,
      'amount', v_payment.amount
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

  insert into public.payment_transactions (payment_id, type, amount, status, reference, metadata)
  values (
    v_payment.id, 'REFUNDED', v_payment.amount, 'REFUNDED', v_payment.reference,
    jsonb_build_object('provider', 'MOCK', 'note', 'Test refund - no funds moved')
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id, 'TEST_PAYMENT_REFUNDED', 'payment', v_payment.id,
    jsonb_build_object('bookingId', v_booking.id, 'amount', v_payment.amount)
  );

  insert into public.notifications (user_id, type, title, message, data)
  values (
    v_booking.user_id, 'SYSTEM', 'Booking refunded',
    'Your booking ' || v_booking.booking_reference || ' has been refunded (test).',
    jsonb_build_object('bookingId', v_booking.id)
  );

  return jsonb_build_object(
    'alreadyRefunded', false,
    'paymentReference', v_payment.reference,
    'bookingReference', v_booking.booking_reference,
    'amount', v_payment.amount
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- expire_stale_payments
--
-- Extends the Phase 4 seat sweep to payments: an unpaid payment past its
-- deadline is cancelled, its booking cancelled, and its seats released.
--
-- Service role only. Expiry must never depend on a client timer, which stops
-- the moment the app is backgrounded.
-- ---------------------------------------------------------------------------

create or replace function public.expire_stale_payments()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payments uuid[];
  v_seats integer;
  v_bookings uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_payments
    from public.payments
   where status in ('PENDING', 'PROCESSING')
     and expires_at is not null
     and expires_at < now();

  update public.payments
     set status = 'CANCELLED', cancelled_at = now()
   where id = any(v_payments);

  insert into public.payment_transactions (payment_id, type, amount, status, reference, metadata)
  select p.id, 'CANCELLED', p.amount, 'CANCELLED', p.reference,
         jsonb_build_object('reason', 'Payment window expired')
    from public.payments p where p.id = any(v_payments);

  -- Then the bookings and seats, reusing the Phase 4 sweep's rules.
  select coalesce(array_agg(id), '{}') into v_bookings
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
    'cancelledPayments', coalesce(array_length(v_payments, 1), 0),
    'cancelledBookings', coalesce(array_length(v_bookings, 1), 0),
    'releasedSeats', v_seats
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
--
-- `get_public_payment` and `confirm_test_payment` are granted to `anon`: the
-- payment page runs in a browser with no session. The token is the credential,
-- and both functions require it.
-- ---------------------------------------------------------------------------

revoke all on function public.create_test_payment(uuid) from public, anon;
grant execute on function public.create_test_payment(uuid) to authenticated;

revoke all on function public.get_public_payment(text, text) from public;
grant execute on function public.get_public_payment(text, text) to anon, authenticated;

revoke all on function public.confirm_test_payment(text, text, text) from public;
grant execute on function public.confirm_test_payment(text, text, text) to anon, authenticated;

revoke all on function public.refund_test_payment(uuid) from public, anon;
grant execute on function public.refund_test_payment(uuid) to authenticated;

revoke all on function public.expire_stale_payments() from public, anon, authenticated;
grant execute on function public.expire_stale_payments() to service_role;
