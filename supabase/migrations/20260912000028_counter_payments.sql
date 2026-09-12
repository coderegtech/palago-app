-- Cash at the counter, and bookings for passengers who have no account.
--
-- An operator can now sell a seat to somebody standing in front of them, take
-- the fare in cash or by a simulated method, and hand over a ticket. Two
-- things about it are worth being explicit about.
--
-- **Cash is real money.** Every other payment in this build is simulated and
-- moves nothing; cash is notes handed across a counter. The database therefore
-- records who took it (`payments.received_by`), when, how much, and against
-- which booking — because that row is the only record that the money exists.
-- `payments_mock_only` becomes `payments_mock_or_cash`: still no electronic
-- provider, no longer "no money". Only `record_counter_payment` can write a
-- CASH payment, and only an operator manager or admin may call it.
--
-- **A walk-in passenger has no account.** `bookings.user_id` becomes nullable:
-- the booking belongs to the passenger and the trip, not to a login. What it
-- gains instead is `created_by` (the clerk), `source` (counter or terminal) and
-- `ticket_type`. Everything keyed to an account holder has to tolerate the
-- absence of one — `award_loyalty_for_booking` is patched below, because
-- without that guard one walk-in aboard would make `end_trip` fail for the
-- whole busload.

alter table public.payments
  add column method public.payment_method,
  add column received_by uuid references auth.users (id) on delete set null;

comment on column public.payments.method is
  'How the money arrived. Null for the mock payment page, which offers no choice of method.';
comment on column public.payments.received_by is
  'The member of staff who took the cash. Required for CASH, forbidden otherwise.';

-- Cash is the only method where somebody is accountable for the money itself.
alter table public.payments
  add constraint payments_cash_has_a_receiver
    check ((method = 'CASH') = (received_by is not null));

alter table public.payments drop constraint payments_mock_only;
alter table public.payments
  add constraint payments_mock_or_cash check (provider in ('MOCK', 'CASH'));

-- CASH belongs to cash, and nothing else may claim that provider.
alter table public.payments
  add constraint payments_cash_provider_matches_method
    check ((provider = 'CASH') = (method = 'CASH'));

create index payments_received_by_idx on public.payments (received_by, paid_at desc);

-- ---------------------------------------------------------------------------
-- A booking need not belong to an account
-- ---------------------------------------------------------------------------

alter table public.bookings
  alter column user_id drop not null,
  add column created_by uuid references auth.users (id) on delete set null,
  add column source public.booking_source not null default 'MOBILE_APP',
  add column ticket_type public.ticket_type not null default 'DIGITAL';

comment on column public.bookings.user_id is
  'The account this booking belongs to, or null for a walk-in sold at a counter.';
comment on column public.bookings.created_by is
  'Who made the booking. The passenger themselves for self-service; the clerk for a counter sale.';

-- Existing bookings were all self-service.
update public.bookings set created_by = user_id where created_by is null;

create index bookings_created_by_idx on public.bookings (created_by, created_at desc);
create index bookings_source_idx on public.bookings (source);

-- ---------------------------------------------------------------------------
-- record_counter_payment
--
-- The operator's side of taking a fare. One call does what the counter does:
-- records the money, issues the receipt, assigns the seats and confirms the
-- booking — or none of it.
--
-- This is the only path to a PAID payment that no passenger can trigger, which
-- is the point: a client cannot mark its own booking paid, in cash or
-- otherwise. It is also idempotent, because a clerk double-tapping "cash
-- received" must not take the fare twice.
-- ---------------------------------------------------------------------------

create or replace function public.record_counter_payment(
  p_booking_id uuid,
  p_method public.payment_method
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := (select auth.uid());
  v_booking public.bookings%rowtype;
  v_trip public.trips%rowtype;
  v_payment public.payments%rowtype;
  v_receipt public.receipts%rowtype;
  v_amount integer;
begin
  if v_staff is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  select * into v_trip from public.trips where id = v_booking.trip_id;

  if not (public.can_manage_operator(v_trip.operator_id) or coalesce(public.is_admin(), false)) then
    raise exception 'FORBIDDEN';
  end if;

  -- A wallet is an account holder's, and it is theirs to spend: a clerk cannot
  -- reach into it. Wallet payments go through `pay_booking_with_wallet`, signed
  -- in as the passenger.
  if p_method = 'TEST_WALLET' then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- Already paid: return the same receipt rather than taking the fare again.
  select * into v_payment
    from public.payments
   where booking_id = v_booking.id and status = 'PAID'
   limit 1;

  if found then
    select * into v_receipt from public.receipts where payment_id = v_payment.id;
    return jsonb_build_object(
      'bookingId', v_booking.id,
      'reference', v_booking.booking_reference,
      'status', v_booking.status,
      'alreadyPaid', true,
      'method', v_payment.method,
      'amount', v_payment.amount,
      'receiptNumber', v_receipt.receipt_number,
      'paidAt', v_payment.paid_at
    );
  end if;

  if v_booking.status not in ('PENDING', 'PAYMENT_PENDING') then
    raise exception 'VALIDATION_ERROR';
  end if;

  if v_booking.expires_at is not null and v_booking.expires_at < now() then
    raise exception 'BOOKING_EXPIRED';
  end if;

  v_amount := v_booking.total_amount;

  -- Any pending online payment for this booking is off the table: the fare has
  -- been settled at the counter.
  update public.payments
     set status = 'CANCELLED', cancelled_at = now()
   where booking_id = v_booking.id and status in ('PENDING', 'PROCESSING');

  insert into public.payments (
    booking_id, provider, method, received_by, amount, currency, status, paid_at
  ) values (
    v_booking.id,
    case when p_method = 'CASH' then 'CASH' else 'MOCK' end::public.payment_provider,
    p_method,
    case when p_method = 'CASH' then v_staff end,
    v_amount,
    v_booking.currency,
    'PAID',
    now()
  )
  returning * into v_payment;

  insert into public.receipts (payment_id, booking_id, amount, currency, payment_method, status)
  values (
    v_payment.id, v_booking.id, v_amount, v_booking.currency,
    case p_method
      when 'CASH' then 'Cash'
      when 'TEST_GCASH' then 'Test GCash'
      when 'TEST_MAYA' then 'Test Maya'
      when 'TEST_CARD' then 'Test card'
      when 'TEST_BANK' then 'Test bank transfer'
      else p_method::text
    end,
    'PAID'
  )
  returning * into v_receipt;

  update public.payments
     set receipt_number = v_receipt.receipt_number
   where id = v_payment.id;

  insert into public.payment_transactions (payment_id, type, amount, status, reference, metadata)
  values (
    v_payment.id, 'PAID', v_amount, 'PAID', v_payment.reference,
    jsonb_build_object('method', p_method, 'takenBy', v_staff, 'atCounter', true)
  );

  update public.bookings
     set status = 'CONFIRMED', confirmed_at = now(), expires_at = null
   where id = v_booking.id;

  update public.trip_seats
     set status = 'BOOKED', confirmed_at = now(), held_until = null
   where booking_id = v_booking.id;

  -- Same rule as every other payment: the seat becomes the passenger's once
  -- the money is in.
  perform public.assign_seats_for_booking(v_booking.id);

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_staff, 'COUNTER_PAYMENT_RECORDED', 'payment', v_payment.id,
    jsonb_build_object(
      'bookingReference', v_booking.booking_reference,
      'method', p_method,
      'amount', v_amount,
      'receiptNumber', v_receipt.receipt_number,
      'tripId', v_booking.trip_id
    )
  );

  -- A walk-in has no account to notify.
  if v_booking.user_id is not null then
    insert into public.notifications (user_id, type, title, message, data)
    values (
      v_booking.user_id, 'PAYMENT_CONFIRMED', 'Payment received',
      'We received ' || (v_amount / 100.0)::numeric(12, 2) || ' PHP for '
        || v_booking.booking_reference || '.',
      jsonb_build_object('bookingId', v_booking.id, 'method', p_method)
    );
  end if;

  return jsonb_build_object(
    'bookingId', v_booking.id,
    'reference', v_booking.booking_reference,
    'status', 'CONFIRMED',
    'alreadyPaid', false,
    'method', p_method,
    'amount', v_amount,
    'receiptNumber', v_receipt.receipt_number,
    'paidAt', v_payment.paid_at
  );
end;
$$;

revoke all on function public.record_counter_payment(uuid, public.payment_method) from public, anon;
grant execute on function public.record_counter_payment(uuid, public.payment_method) to authenticated;

-- create_booking: from 20260912000026_payment_before_seat.sql.
-- The 3-argument version is dropped rather than left beside this one: with
-- defaults on the new parameters, a 3-argument call would match both and
-- Postgres would refuse it as ambiguous.
drop function public.create_booking(uuid, jsonb, uuid[]);

create or replace function public.create_booking(
  p_trip_id uuid,
  p_passengers jsonb,
  p_seat_ids uuid[] default null,
  p_walk_in boolean default false,
  p_source public.booking_source default 'MOBILE_APP',
  p_ticket_type public.ticket_type default 'DIGITAL'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- pay_booking_with_wallet: from 20260912000026_payment_before_seat.sql.
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
    booking_id, provider, method, amount, currency, status, paid_at
  ) values (
    v_booking.id, 'MOCK', 'TEST_WALLET', v_amount, v_booking.currency, 'PAID', now()
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

-- award_loyalty_for_booking: from 20260909000018_loyalty.sql.
create or replace function public.award_loyalty_for_booking(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_paid integer;
  v_points integer;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    return 0;
  end if;

  -- Earned for travelling, not for paying. Anything short of COMPLETED has not
  -- earned anything yet.
  -- A walk-in sold at the counter has no account to hold points. Without this,
  -- one of them aboard made end_trip fail for the whole trip.
  if v_booking.user_id is null then
    return 0;
  end if;

  if v_booking.status <> 'COMPLETED' then
    return 0;
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from public.payments
   where booking_id = p_booking_id and status = 'PAID';

  v_points := public.loyalty_points_for(v_paid);
  if v_points <= 0 then
    return 0;
  end if;

  -- Lock the account so a concurrent redemption cannot interleave.
  perform 1 from public.loyalty_accounts where user_id = v_booking.user_id for update;

  begin
    perform public.loyalty_post(
      v_booking.user_id, 'EARNED', v_points, v_booking.booking_reference,
      'Points for completed trip ' || v_booking.booking_reference, p_booking_id
    );
  exception when unique_violation then
    -- The exactly-once index did its job: this booking has already earned.
    return 0;
  end;

  insert into public.notifications (user_id, type, title, message, data)
  values (
    v_booking.user_id, 'SYSTEM', 'You earned ' || v_points || ' points',
    'Thanks for travelling with PalaGo. Booking ' || v_booking.booking_reference
      || ' earned you ' || v_points || ' points.',
    jsonb_build_object('bookingId', p_booking_id, 'points', v_points)
  );

  return v_points;
end;
$$;
