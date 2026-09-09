-- Phase 9: the mock wallet.
--
-- A wallet holds TEST money. Nothing here touches a real balance, a real card
-- or a real bank, and `payments.provider` remains constrained to MOCK. A wallet
-- top-up creates centavos out of nothing on purpose, which is exactly why it is
-- bounded and audited rather than casual.
--
-- Two invariants this file exists to hold:
--
--   1. `wallets.balance` always equals the sum of that wallet's ledger rows.
--      Balance and ledger are written together, under the same row lock, in
--      SECURITY DEFINER functions. There is no client write path to either.
--   2. Paying a booking from the wallet reaches exactly the same end state as
--      paying by QR: a PAID `payments` row, a receipt, BOOKED seats, a
--      CONFIRMED booking, an audit entry and a notification. Anything less and
--      the boarding pass, the operator manifest and the revenue figures would
--      all disagree about whether the passenger paid.

-- ---------------------------------------------------------------------------
-- Types and limits
-- ---------------------------------------------------------------------------

create type public.wallet_transaction_type as enum (
  'TOP_UP', 'BOOKING_PAYMENT', 'REFUND', 'REWARD', 'ADJUSTMENT'
);

/**
 * Bounds on test money.
 *
 * Not security — a bounded fake balance is no safer than an unbounded one — but
 * a wallet showing ₱90,000,000 makes every screen it appears on look broken,
 * and an integer column has an end. Mirrored in src/constants/config.ts.
 */
create or replace function public.wallet_max_top_up()
returns integer language sql immutable as $$ select 1000000 $$;   -- ₱10,000.00

create or replace function public.wallet_max_balance()
returns integer language sql immutable as $$ select 5000000 $$;   -- ₱50,000.00

-- ---------------------------------------------------------------------------
-- wallets
--
-- One per user, created with the profile so no screen has to handle "you have
-- no wallet yet" as distinct from "your balance is zero".
-- ---------------------------------------------------------------------------

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  -- Centavos. ₱450.00 is 45000. Never a float — see docs/database.md.
  balance integer not null default 0,
  currency text not null default 'PHP',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallets_balance_not_negative check (balance >= 0),
  constraint wallets_balance_bounded check (balance <= 5000000)
);

comment on table public.wallets is
  'Mock wallet. Every centavo in here is test money; PalaGo charges nothing real.';
comment on column public.wallets.balance is 'Test balance in centavos. Equals the sum of the wallet ledger.';

create trigger wallets_set_updated_at
  before update on public.wallets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- wallet_transactions
--
-- Append-only ledger. `amount` is SIGNED: a credit is positive, a debit
-- negative, so `sum(amount) = wallets.balance` is a single checkable invariant
-- rather than a rule about which types subtract. `pnpm db:verify:wallet`
-- asserts exactly that.
-- ---------------------------------------------------------------------------

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets (id) on delete cascade,
  type public.wallet_transaction_type not null,
  amount integer not null,
  balance_before integer not null,
  balance_after integer not null,
  -- What this entry was for: a booking reference, a payment reference.
  reference text,
  description text,
  booking_id uuid references public.bookings (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  -- Supplied by the caller so a retried request after a dropped response
  -- credits the wallet once, not twice.
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint wallet_transactions_amount_not_zero check (amount <> 0),
  constraint wallet_transactions_balances_agree check (balance_after = balance_before + amount),
  constraint wallet_transactions_balances_not_negative
    check (balance_before >= 0 and balance_after >= 0),
  -- Direction must match the kind of entry. A TOP_UP that debits, or a
  -- BOOKING_PAYMENT that credits, is a bug worth refusing at the database.
  constraint wallet_transactions_direction check (
    (type in ('TOP_UP', 'REFUND', 'REWARD') and amount > 0)
    or (type = 'BOOKING_PAYMENT' and amount < 0)
    or type = 'ADJUSTMENT'
  )
);

comment on table public.wallet_transactions is
  'Append-only wallet ledger. Signed amounts: credits positive, debits negative. Sums to wallets.balance.';

create index wallet_transactions_wallet_idx
  on public.wallet_transactions (wallet_id, created_at desc);
create index wallet_transactions_booking_idx on public.wallet_transactions (booking_id);

-- One credit per idempotency key per wallet.
create unique index wallet_transactions_idempotency_idx
  on public.wallet_transactions (wallet_id, idempotency_key)
  where idempotency_key is not null;

-- A payment is charged to a wallet once and refunded to it once. This is what
-- makes `refund_test_payment` safe to call twice.
create unique index wallet_transactions_one_per_payment_idx
  on public.wallet_transactions (payment_id, type)
  where payment_id is not null;

-- ---------------------------------------------------------------------------
-- Every profile gets a wallet
-- ---------------------------------------------------------------------------

create or replace function public.create_wallet_for_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.wallets (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger profiles_create_wallet
  after insert on public.profiles
  for each row execute function public.create_wallet_for_profile();

-- Existing profiles, including the seeded accounts.
insert into public.wallets (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Read your own wallet and your own ledger. No client write path to either:
-- balance and ledger must move together, and a client that can UPDATE a balance
-- can pay for a trip it never bought.
-- ---------------------------------------------------------------------------

alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;

create policy "Users read their own wallet"
  on public.wallets for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy "Users read their own wallet ledger"
  on public.wallet_transactions for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.wallets w
      where w.id = wallet_id and w.user_id = (select auth.uid())
    )
  );

revoke insert, update, delete on public.wallets from anon, authenticated;
revoke insert, update, delete on public.wallet_transactions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal: move the balance and write the ledger together.
--
-- Private (no grant). Every caller must already hold the wallet row lock.
-- ---------------------------------------------------------------------------

create or replace function public.wallet_post(
  p_wallet_id uuid,
  p_type public.wallet_transaction_type,
  p_amount integer,
  p_reference text default null,
  p_description text default null,
  p_booking_id uuid default null,
  p_payment_id uuid default null,
  p_idempotency_key text default null
)
returns public.wallet_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before integer;
  v_after integer;
  v_row public.wallet_transactions;
begin
  select balance into v_before from public.wallets where id = p_wallet_id;
  v_after := v_before + p_amount;

  if v_after < 0 then
    raise exception 'INSUFFICIENT_FUNDS';
  end if;

  if v_after > public.wallet_max_balance() then
    raise exception 'WALLET_LIMIT_EXCEEDED';
  end if;

  insert into public.wallet_transactions (
    wallet_id, type, amount, balance_before, balance_after,
    reference, description, booking_id, payment_id, idempotency_key
  ) values (
    p_wallet_id, p_type, p_amount, v_before, v_after,
    p_reference, p_description, p_booking_id, p_payment_id, p_idempotency_key
  )
  returning * into v_row;

  update public.wallets set balance = v_after where id = p_wallet_id;

  return v_row;
end;
$$;

revoke all on function public.wallet_post(
  uuid, public.wallet_transaction_type, integer, text, text, uuid, uuid, text
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- top_up_wallet
--
-- Mock only. Creates test centavos from nothing, which is the whole point and
-- also why it is bounded, audited, and idempotent on a caller-supplied key.
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
    'Test top-up - no real money received', null, null, p_idempotency_key
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
-- pay_booking_with_wallet
--
-- The second way to pay, and it must land in the same place as the first.
-- Compare against `confirm_test_payment` in 20260909000008: every precondition
-- there is repeated here, because a booking paid by wallet has to be
-- indistinguishable downstream from one paid by QR — the boarding pass, the
-- operator manifest and the revenue totals all read `payments` and `receipts`.
--
-- The amount is re-derived from the booking. The client sends a booking id and
-- nothing else; it does not get to say what a trip costs.
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
  values (v_payment.id, v_booking.id, v_amount, v_payment.currency, 'TEST WALLET', 'PAID')
  returning * into v_receipt;

  update public.payments
     set receipt_number = v_receipt.receipt_number
   where id = v_payment.id;

  perform public.wallet_post(
    v_wallet.id, 'BOOKING_PAYMENT', -v_amount, v_booking.booking_reference,
    'Booking ' || v_booking.booking_reference || ' (test payment)',
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
    v_user_id, 'PAYMENT_CONFIRMED', 'Paid from your test wallet',
    'Booking ' || v_booking.booking_reference || ' is confirmed. No real money was charged.',
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

revoke all on function public.top_up_wallet(integer, text) from public, anon;
revoke all on function public.pay_booking_with_wallet(uuid) from public, anon;
grant execute on function public.top_up_wallet(integer, text) to authenticated;
grant execute on function public.pay_booking_with_wallet(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Refunds go back where the money came from
--
-- `refund_test_payment` already reverses the payment and releases the seats.
-- Without this, a wallet-paid booking would be refunded and the balance would
-- simply never come back — the ledger would say the passenger spent money that
-- no longer bought anything.
--
-- Recognising a wallet payment by its ledger row rather than by a flag on
-- `payments` means there is one source of truth, and the partial unique index
-- on (payment_id, type) makes the credit-back idempotent for free.
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
      )
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

  -- Was this paid from a wallet? If so, put it back.
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

  insert into public.payment_transactions (payment_id, type, amount, status, reference, metadata)
  values (
    v_payment.id, 'REFUNDED', v_payment.amount, 'REFUNDED', v_payment.reference,
    jsonb_build_object('provider', 'MOCK', 'toWallet', v_refunded_to_wallet,
                       'note', 'Test refund - no funds moved')
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id, 'TEST_PAYMENT_REFUNDED', 'payment', v_payment.id,
    jsonb_build_object('bookingId', v_booking.id, 'amount', v_payment.amount,
                       'toWallet', v_refunded_to_wallet)
  );

  insert into public.notifications (user_id, type, title, message, data)
  values (
    v_booking.user_id, 'SYSTEM', 'Booking refunded',
    case when v_refunded_to_wallet
      then 'Your booking ' || v_booking.booking_reference ||
           ' has been refunded to your test wallet.'
      else 'Your booking ' || v_booking.booking_reference || ' has been refunded (test).'
    end,
    jsonb_build_object('bookingId', v_booking.id, 'toWallet', v_refunded_to_wallet)
  );

  return jsonb_build_object(
    'alreadyRefunded', false,
    'paymentReference', v_payment.reference,
    'bookingReference', v_booking.booking_reference,
    'amount', v_payment.amount,
    'refundedToWallet', v_refunded_to_wallet
  );
end;
$$;

revoke all on function public.refund_test_payment(uuid) from public, anon;
grant execute on function public.refund_test_payment(uuid) to authenticated;
