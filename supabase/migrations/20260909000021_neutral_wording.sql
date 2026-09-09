-- Remove the test-mode wording that was stored in the database.
--
-- Taking the banners out of the UI was not enough: several user-visible strings
-- are written by the database and then displayed. The wallet screen showed
-- "Test top-up - no real money received" on every top-up row, because that is
-- the ledger description `top_up_wallet` writes; receipts carried a
-- `payment_method` of 'TEST PAYMENT'; and the notification feed said "Paid from
-- your test wallet". Browser verification is what surfaced these — the UI sweep
-- alone reported clean.
--
-- The four functions below are reproduced from their newest definitions with
-- only the wording changed. Every precondition, lock and idempotency branch is
-- byte-for-byte as previously verified; `pnpm db:verify:all` re-checks that.
--
-- WHAT HAS NOT CHANGED: `payments.provider` is still constrained to MOCK and
-- `src/lib/env.ts` still refuses any other provider. No money moves. The system
-- simply no longer announces that on screen, which means a receipt from this
-- build is now visually indistinguishable from a real one.

-- ---------------------------------------------------------------------------
-- Column default
-- ---------------------------------------------------------------------------

alter table public.receipts alter column payment_method set default 'PalaGo Payment';

-- ---------------------------------------------------------------------------
-- Existing rows
--
-- Rewritten rather than left in place: these strings are shown to the user, so
-- leaving history untouched would mean the notices persist for exactly the
-- accounts that have used the app.
-- ---------------------------------------------------------------------------

update public.receipts
   set payment_method = case payment_method
     when 'TEST PAYMENT' then 'PalaGo Payment'
     when 'TEST WALLET' then 'PalaGo Wallet'
     else payment_method
   end
 where payment_method in ('TEST PAYMENT', 'TEST WALLET');

update public.wallet_transactions
   set description = 'Wallet top-up'
 where description = 'Test top-up - no real money received';

update public.wallet_transactions
   set description = replace(description, ' (test payment)', '')
 where description like '%(test payment)%';

update public.wallet_transactions
   set description = replace(description, ' (test)', '')
 where description like '%(test)%';

update public.loyalty_transactions
   set description = replace(description, ' (test)', '')
 where description like '%(test)%';

update public.notifications
   set title = 'Payment confirmed'
 where title = 'Test payment confirmed';

update public.notifications
   set title = 'Paid from your wallet'
 where title = 'Paid from your test wallet';

update public.notifications
   set message = replace(
         replace(message, ' No real money was charged.', ''),
         'your test wallet', 'your wallet')
 where message like '%No real money was charged.%' or message like '%your test wallet%';

update public.notifications
   set message = replace(message, ' has been refunded (test).', ' has been refunded.')
 where message like '%has been refunded (test).%';

-- ---------------------------------------------------------------------------
-- confirm_test_payment (from 20260909000008_payment_functions.sql)
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

-- ---------------------------------------------------------------------------
-- top_up_wallet (from 20260909000017_wallet.sql)
-- ---------------------------------------------------------------------------

create or replace function public.top_up_wallet(
  p_amount integer,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_wallet public.wallets%rowtype;
  v_existing public.wallet_transactions%rowtype;
  v_row public.wallet_transactions;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'VALIDATION_ERROR';
  end if;

  if p_amount > public.wallet_max_top_up() then
    raise exception 'WALLET_LIMIT_EXCEEDED';
  end if;

  -- Lock first: two simultaneous top-ups serialise here rather than both
  -- reading the same starting balance.
  select * into v_wallet from public.wallets where user_id = v_user_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  -- A retry after a dropped response must not credit twice.
  if p_idempotency_key is not null then
    select * into v_existing
      from public.wallet_transactions
     where wallet_id = v_wallet.id and idempotency_key = p_idempotency_key;

    if found then
      return jsonb_build_object(
        'alreadyApplied', true,
        'transactionId', v_existing.id,
        'amount', v_existing.amount,
        'balance', v_wallet.balance,
        'currency', v_wallet.currency
      );
    end if;
  end if;

  v_row := public.wallet_post(
    v_wallet.id, 'TOP_UP', p_amount, null,
    'Wallet top-up', null, null, p_idempotency_key
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id, 'WALLET_TEST_TOP_UP', 'wallet', v_wallet.id,
    jsonb_build_object('amount', p_amount, 'balanceAfter', v_row.balance_after, 'mock', true)
  );

  return jsonb_build_object(
    'alreadyApplied', false,
    'transactionId', v_row.id,
    'amount', v_row.amount,
    'balance', v_row.balance_after,
    'currency', v_wallet.currency
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- pay_booking_with_wallet (from 20260909000017_wallet.sql)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- refund_test_payment (from 20260909000019_loyalty_hooks.sql)
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

revoke all on function public.confirm_test_payment(text, text, text) from public, anon;
grant execute on function public.confirm_test_payment(text, text, text) to anon, authenticated;
revoke all on function public.top_up_wallet(integer, text) from public, anon;
grant execute on function public.top_up_wallet(integer, text) to authenticated;
revoke all on function public.pay_booking_with_wallet(uuid) from public, anon;
grant execute on function public.pay_booking_with_wallet(uuid) to authenticated;
revoke all on function public.refund_test_payment(uuid) from public, anon;
grant execute on function public.refund_test_payment(uuid) to authenticated;
