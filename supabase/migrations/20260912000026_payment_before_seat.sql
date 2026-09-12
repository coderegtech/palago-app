-- Payment before the seat is assigned.
--
-- The booking flow used to be: pick a seat, hold it, pay. Now a passenger never
-- picks a seat at all (the operator or the system assigns it — the
-- specification's first rule), and the seat becomes theirs only once the
-- payment is verified:
--
--   choose trip -> passenger details -> summary -> pay -> verify -> SEAT ASSIGNED
--
-- **Capacity is still held while they pay, and that is deliberate.** Taking
-- money with nothing reserved lets two passengers pay for the last seat, and
-- one of them then gets a refund instead of a trip. So `create_booking` holds
-- as many seats as the booking needs — anonymously, for ten minutes, exactly as
-- before — and `assign_seats_for_booking` decides *which passenger sits where*
-- after payment. Nothing about overselling changes; what changes is when a
-- named person is tied to a numbered seat.
--
-- Two consequences elsewhere:
--   * `booking_passengers.seat_id` is nullable — before payment nobody has a
--     seat number yet.
--   * releasing a seat (cancel, refund, expiry) clears the assignment too. A
--     cancelled passenger keeping a seat that has since been resold is how the
--     manifest ended up listing 26 cancelled passengers in occupied seats.

alter table public.booking_passengers alter column seat_id drop not null;

comment on column public.booking_passengers.seat_id is
  'The seat this passenger sits in. Null until the payment is verified — seats are assigned then, not at booking.';

-- ---------------------------------------------------------------------------
-- assign_seats_for_booking
--
-- Hands this booking's held seats to its passengers, front of the bus first,
-- in the order the passengers were entered. Internal: called by the payment
-- functions, never by a client.
--
-- Idempotent, and it never moves anyone: only passengers without a seat are
-- given one, so an operator's later reassignment stands.
-- ---------------------------------------------------------------------------

create or replace function public.assign_seats_for_booking(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assigned integer := 0;
begin
  with seats as (
    select ts.seat_id,
           row_number() over (order by bs.row_number, bs.column_number, bs.seat_number) as rn
      from public.trip_seats ts
      join public.bus_seats bs on bs.id = ts.seat_id
     where ts.booking_id = p_booking_id
       -- A seat already given to one of this booking's passengers is not free
       -- to hand to another.
       and not exists (
         select 1 from public.booking_passengers bp
         where bp.booking_id = p_booking_id and bp.seat_id = ts.seat_id
       )
  ),
  people as (
    select bp.id, row_number() over (order by bp.created_at, bp.id) as rn
      from public.booking_passengers bp
     where bp.booking_id = p_booking_id and bp.seat_id is null
  )
  update public.booking_passengers bp
     set seat_id = seats.seat_id
    from people
    join seats on seats.rn = people.rn
   where bp.id = people.id;

  get diagnostics v_assigned = row_count;
  return v_assigned;
end;
$$;

revoke all on function public.assign_seats_for_booking(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_booking
--
-- Replaces `reserve_seats`, which took a seat id per passenger. Dropped rather
-- than left in place: a client-chooses-the-seat entry point still on the
-- database is still callable over RPC, and the specification says passengers do
-- not choose seats.
--
-- `p_seat_ids` is for the operator counter, where staff do pick seats. It is
-- refused for anyone who is not an operator manager or admin of the trip's
-- operator.
--
-- The locking is unchanged in substance from `reserve_seats`: rows are locked
-- before availability is judged, lapsed holds are reclaimed first, and callers
-- never wait on each other for seats they did not both ask for. What is new is
-- that the system picks the seats, with FOR UPDATE SKIP LOCKED — two people
-- buying at the same moment take different seats instead of queueing for the
-- same one.
-- ---------------------------------------------------------------------------

create or replace function public.create_booking(
  p_trip_id uuid,
  p_passengers jsonb,
  p_seat_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id       uuid := (select auth.uid());
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
    -- The counter picks. Staff only.
    if not (
      public.can_manage_operator(v_trip.operator_id) or coalesce(public.is_admin(), false)
    ) then
      raise exception 'FORBIDDEN';
    end if;

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
  v_kind := public.active_discount_kind(v_user_id);

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
    user_id, trip_id, booking_reference, status,
    subtotal, discount, loyalty_discount, total_amount, expires_at
  )
  values (
    v_user_id, p_trip_id, v_reference, 'PAYMENT_PENDING',
    v_subtotal, v_discount, 0, v_subtotal - v_discount, v_expires_at
  )
  returning id into v_booking_id;

  insert into public.booking_passengers (
    booking_id, user_id, seat_id, passenger_name, phone, email, passenger_type,
    discount_amount, discount_kind
  )
  select
    v_booking_id,
    v_user_id,
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
    -- Deliberately not a seat list: nobody has a seat number until they pay.
    'seatsAssigned', false,
    'expiresAt', v_expires_at
  );
end;
$$;

drop function public.reserve_seats(uuid, jsonb);

revoke all on function public.create_booking(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.create_booking(uuid, jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- The manifest is who is travelling
--
-- It had no booking-status filter, so it listed cancelled and refunded
-- passengers — 26 of them on the seeded database — in seats that had since been
-- sold to somebody else. The passenger *count* on the same trip already used
-- this list of statuses, so the two disagreed.
-- ---------------------------------------------------------------------------

-- operator_manifest: from 20260911000025_boarding_scope.sql, filtered to live bookings.
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
where (t.operator_id = public.current_operator_id() or public.is_admin())
  -- Who is actually travelling. Without this the manifest listed cancelled and
  -- refunded passengers, in seats that had since been resold — and disagreed
  -- with the passenger count on the same trip, which always used this list.
  and bk.status in ('CONFIRMED', 'CHECKED_IN', 'BOARDED', 'ON_TRIP', 'COMPLETED');
-- confirm_test_payment: from 20260909000021_neutral_wording.sql, with the seat assignment moved to payment.
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
  values (v_payment.id, v_booking.id, v_payment.amount, v_payment.currency, 'PalaGo Payment', 'PAID')
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

  -- The seat becomes this passenger's only now that the payment is verified.
  perform public.assign_seats_for_booking(v_booking.id);

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
    'Payment confirmed',
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

-- pay_booking_with_wallet: from 20260909000021_neutral_wording.sql, with the seat assignment moved to payment.
create or replace function public.pay_booking_with_wallet(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_booking public.bookings%rowtype;
  v_wallet public.wallets%rowtype;
  v_payment public.payments%rowtype;
  v_receipt public.receipts%rowtype;
  v_amount integer;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  -- Consistent lock order everywhere in this file: booking, then wallet.
  -- Taking them in different orders in different functions is how deadlocks
  -- appear under concurrency.
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_booking.user_id <> v_user_id then
    raise exception 'FORBIDDEN';
  end if;

  -- Already paid: return the existing receipt rather than charging again.
  if v_booking.status = 'CONFIRMED' then
    select * into v_payment
      from public.payments where booking_id = v_booking.id and status = 'PAID' limit 1;
    if found then
      select * into v_receipt from public.receipts where payment_id = v_payment.id;
      return jsonb_build_object(
        'alreadyPaid', true,
        'bookingReference', v_booking.booking_reference,
        'bookingStatus', v_booking.status,
        'paymentReference', v_payment.reference,
        'receiptNumber', v_receipt.receipt_number,
        'amount', v_payment.amount,
        'currency', v_payment.currency
      );
    end if;
    raise exception 'BOOKING_ALREADY_CONFIRMED';
  end if;

  if v_booking.status = 'CANCELLED' then
    raise exception 'BOOKING_EXPIRED';
  end if;

  if v_booking.status not in ('PENDING', 'PAYMENT_PENDING') then
    raise exception 'BOOKING_ALREADY_CONFIRMED';
  end if;

  if v_booking.expires_at is not null and v_booking.expires_at < now() then
    raise exception 'BOOKING_EXPIRED';
  end if;

  -- A QR payment already in flight for this booking is cancelled rather than
  -- left PENDING: paying twice for one booking must not be reachable, and the
  -- partial unique index on live payments would refuse the insert below anyway.
  update public.payments
     set status = 'CANCELLED', cancelled_at = now()
   where booking_id = v_booking.id and status = 'PENDING';

  v_amount := v_booking.total_amount;

  select * into v_wallet from public.wallets where user_id = v_user_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_wallet.balance < v_amount then
    raise exception 'INSUFFICIENT_FUNDS';
  end if;

  -- A real payment row, so nothing downstream has to know how it was paid.
  insert into public.payments (
    booking_id, provider, amount, currency, status, paid_at
  ) values (
    v_booking.id, 'MOCK', v_amount, v_booking.currency, 'PAID', now()
  )
  returning * into v_payment;

  insert into public.receipts (payment_id, booking_id, amount, currency, payment_method, status)
  values (v_payment.id, v_booking.id, v_amount, v_payment.currency, 'PalaGo Wallet', 'PAID')
  returning * into v_receipt;

  update public.payments
     set receipt_number = v_receipt.receipt_number
   where id = v_payment.id;

  perform public.wallet_post(
    v_wallet.id, 'BOOKING_PAYMENT', -v_amount, v_booking.booking_reference,
    'Booking ' || v_booking.booking_reference,
    v_booking.id, v_payment.id, null
  );

  update public.bookings
     set status = 'CONFIRMED', confirmed_at = now(), expires_at = null
   where id = v_booking.id;

  update public.trip_seats
     set status = 'BOOKED', confirmed_at = now(), held_until = null
   where booking_id = v_booking.id;

  -- The seat becomes this passenger's only now that the payment is verified.
  perform public.assign_seats_for_booking(v_booking.id);

  insert into public.payment_transactions (payment_id, type, amount, status, reference, metadata)
  values (
    v_payment.id, 'PAID', v_amount, 'PAID', v_receipt.receipt_number,
    jsonb_build_object('provider', 'MOCK', 'method', 'WALLET',
                       'note', 'Test payment from mock wallet - no funds moved')
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id, 'WALLET_BOOKING_PAID', 'payment', v_payment.id,
    jsonb_build_object(
      'bookingId', v_booking.id,
      'bookingReference', v_booking.booking_reference,
      'receiptNumber', v_receipt.receipt_number,
      'amount', v_amount
    )
  );

  insert into public.notifications (user_id, type, title, message, data)
  values (
    v_user_id, 'PAYMENT_CONFIRMED', 'Paid from your wallet',
    'Booking ' || v_booking.booking_reference || ' is confirmed.',
    jsonb_build_object(
      'bookingId', v_booking.id,
      'bookingReference', v_booking.booking_reference,
      'receiptNumber', v_receipt.receipt_number
    )
  );

  return jsonb_build_object(
    'alreadyPaid', false,
    'bookingReference', v_booking.booking_reference,
    'bookingStatus', 'CONFIRMED',
    'paymentReference', v_payment.reference,
    'receiptNumber', v_receipt.receipt_number,
    'amount', v_amount,
    'currency', v_payment.currency,
    'walletBalance', v_wallet.balance - v_amount
  );
end;
$$;

-- cancel_booking: from 20260909000019_loyalty_hooks.sql, with the seat assignment moved to payment.
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

  update public.booking_passengers set seat_id = null where booking_id = p_booking_id;

  return jsonb_build_object(
    'bookingId', v_booking.id,
    'status', 'CANCELLED',
    'pointsReturned', v_points_returned
  );
end;
$$;

-- refund_test_payment: from 20260909000021_neutral_wording.sql, with the seat assignment moved to payment.
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

  update public.booking_passengers set seat_id = null where booking_id = v_booking.id;

  -- Was this paid from a wallet? If so, put it back. (Phase 9.)
  select * into v_charge
    from public.wallet_transactions
   where payment_id = v_payment.id and type = 'BOOKING_PAYMENT';

  if found then
    select * into v_wallet from public.wallets where id = v_charge.wallet_id for update;
    perform public.wallet_post(
      v_wallet.id, 'REFUND', -v_charge.amount, v_booking.booking_reference,
      'Refund for booking ' || v_booking.booking_reference,
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
           ' has been refunded to your wallet.'
      else 'Your booking ' || v_booking.booking_reference || ' has been refunded.'
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

-- expire_seat_holds: from 20260909000005_reserve_seats.sql, with the seat assignment moved to payment.
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

  update public.booking_passengers set seat_id = null
   where booking_id = any(v_bookings);

  return jsonb_build_object(
    'cancelledBookings', coalesce(array_length(v_bookings, 1), 0),
    'releasedSeats', v_seats
  );
end;
$$;

-- get_public_payment: from 20260909000008_payment_functions.sql, with seats
-- left-joined because the payment page renders before they are assigned.
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
             ) order by bp.created_at), '[]'::jsonb)
        from public.booking_passengers bp
        -- Left join, and ordered by entry rather than seat: this page is shown
        -- *before* payment, and seats are assigned after it. An inner join here
        -- showed a payment page with no passengers on it at all.
        left join public.bus_seats bs on bs.id = bp.seat_id
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
