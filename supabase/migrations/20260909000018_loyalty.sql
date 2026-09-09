-- Phase 10: loyalty.
--
-- The rule that shapes everything here: **points are earned for a trip that was
-- actually taken.** Not for booking, not for paying — for travelling. So points
-- are awarded inside `end_trip`, at the moment a booking becomes COMPLETED,
-- which by Phase 8's design only happens to passengers who boarded.
--
-- Awarding at payment would have been easier and wrong: a passenger who pays
-- and never shows up would collect points for a seat that travelled empty, and
-- a refund would then have to claw them back from a balance they may already
-- have spent.
--
-- Idempotency is not optional. `end_trip` is deliberately callable twice (a
-- driver on a patchy road retries), so awarding must be exactly-once. That is
-- enforced by a unique index on (user, booking, EARNED) rather than by
-- remembering to check.

-- ---------------------------------------------------------------------------
-- Types and the earning rate
-- ---------------------------------------------------------------------------

create type public.loyalty_transaction_type as enum (
  'EARNED', 'REDEEMED', 'EXPIRED', 'ADJUSTED', 'BONUS'
);

create type public.discount_type as enum ('FIXED', 'PERCENTAGE', 'PERK');

/**
 * One point per ₱10 actually paid, rounded down.
 *
 * Rounding down, not to nearest: a ₱5 fare earning a point is money invented
 * from rounding, and across enough bookings that is a real liability in a real
 * scheme. Mirrored by LOYALTY_CENTAVOS_PER_POINT in src/constants/config.ts.
 */
create or replace function public.loyalty_points_for(p_amount_centavos integer)
returns integer
language sql
immutable
as $$ select greatest(0, coalesce(p_amount_centavos, 0) / 1000) $$;

comment on function public.loyalty_points_for(integer) is
  'Points earned for an amount in centavos: one point per ₱10, rounded down.';

-- ---------------------------------------------------------------------------
-- loyalty_accounts
--
-- Created with the profile, like the wallet, so no screen has to distinguish
-- "no account" from "no points".
--
-- `lifetime_points` only ever increases, and only for credits. It is what a
-- tier or a badge would be computed from later; spending points must not undo
-- the fact that you once earned them.
-- ---------------------------------------------------------------------------

create table public.loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  points_balance integer not null default 0,
  lifetime_points integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_balance_not_negative check (points_balance >= 0),
  constraint loyalty_lifetime_not_negative check (lifetime_points >= 0)
);

comment on table public.loyalty_accounts is
  'Points balance per user. Points are earned for completed trips only.';

create trigger loyalty_accounts_set_updated_at
  before update on public.loyalty_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- loyalty_transactions
--
-- Append-only, signed, and summing to the balance — the same shape as the
-- wallet ledger in Phase 9, for the same reason: one checkable invariant beats
-- a rule about which types subtract.
-- ---------------------------------------------------------------------------

create table public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.loyalty_transaction_type not null,
  points integer not null,
  balance_before integer not null,
  balance_after integer not null,
  reference text,
  description text,
  booking_id uuid references public.bookings (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint loyalty_transactions_points_not_zero check (points <> 0),
  constraint loyalty_transactions_balances_agree
    check (balance_after = balance_before + points),
  constraint loyalty_transactions_balances_not_negative
    check (balance_before >= 0 and balance_after >= 0),
  constraint loyalty_transactions_direction check (
    (type in ('EARNED', 'BONUS') and points > 0)
    or (type in ('REDEEMED', 'EXPIRED') and points < 0)
    or type = 'ADJUSTED'
  )
);

comment on table public.loyalty_transactions is
  'Append-only points ledger. Signed: credits positive, debits negative. Sums to points_balance.';

create index loyalty_transactions_user_idx
  on public.loyalty_transactions (user_id, created_at desc);

/*
  The index that makes earning exactly-once. `end_trip` may be called any number
  of times; only the first insert of an EARNED row for a given booking can
  succeed. This is a constraint rather than an `if not exists` check because the
  check-then-insert version has a race, and two crew members ending the same
  trip from two phones is not far-fetched.
*/
create unique index loyalty_transactions_one_earn_per_booking_idx
  on public.loyalty_transactions (user_id, booking_id, type)
  where booking_id is not null and type = 'EARNED';

-- ---------------------------------------------------------------------------
-- rewards
--
-- World-readable reference data, like terminals and routes.
--
-- Note what is NOT seeded: any PERK reward. `discount_type` allows one, but a
-- "priority boarding" or "free bottled water" reward that nothing in the system
-- enforces would be a feature that exists only as a row in a table — the sort
-- of thing this project refuses to ship. FIXED and PERCENTAGE both do something
-- real: they reduce what the passenger pays.
-- ---------------------------------------------------------------------------

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  points_required integer not null,
  discount_type public.discount_type not null,
  -- Centavos for FIXED; basis points for PERCENTAGE (500 = 5%); unused for PERK.
  discount_value integer not null,
  -- A percentage reward without a cap is unbounded on a large booking.
  max_discount integer,
  status public.operator_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rewards_points_positive check (points_required > 0),
  constraint rewards_value_sane check (
    (discount_type = 'FIXED' and discount_value > 0)
    or (discount_type = 'PERCENTAGE' and discount_value between 1 and 10000)
    or (discount_type = 'PERK' and discount_value = 0)
  ),
  constraint rewards_percentage_capped check (
    discount_type <> 'PERCENTAGE' or max_discount is not null
  )
);

comment on column public.rewards.discount_value is
  'Centavos for FIXED, basis points for PERCENTAGE (500 = 5%), 0 for PERK.';

create trigger rewards_set_updated_at
  before update on public.rewards
  for each row execute function public.set_updated_at();

insert into public.rewards (code, name, description, points_required, discount_type, discount_value, max_discount)
values
  ('FIFTY_OFF', '₱50 off your next trip',
   'A flat ₱50 off any PalaGo booking.', 50, 'FIXED', 5000, null),
  ('HUNDRED_OFF', '₱100 off your next trip',
   'A flat ₱100 off any PalaGo booking.', 90, 'FIXED', 10000, null),
  ('TEN_PERCENT', '10% off your next trip',
   'Ten percent off, up to ₱150.', 120, 'PERCENTAGE', 1000, 15000),
  ('TWENTY_PERCENT', '20% off a long haul',
   'Twenty percent off, up to ₱300. Worth saving for El Nido or Coron.',
   250, 'PERCENTAGE', 2000, 30000);

-- ---------------------------------------------------------------------------
-- reward_redemptions
--
-- A redemption is attached to a booking and reduces what that booking costs.
-- Points are not a wallet: there is nothing to redeem "into" except a fare.
-- ---------------------------------------------------------------------------

create table public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  reward_id uuid not null references public.rewards (id) on delete restrict,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  points_used integer not null,
  discount_applied integer not null,
  status public.operator_status not null default 'ACTIVE',
  redeemed_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint redemptions_points_positive check (points_used > 0),
  constraint redemptions_discount_positive check (discount_applied > 0)
);

create index reward_redemptions_user_idx on public.reward_redemptions (user_id);

-- One live redemption per booking. Stacking rewards is a pricing decision
-- nobody has made, so the database refuses it rather than the UI hiding it.
create unique index reward_redemptions_one_active_per_booking_idx
  on public.reward_redemptions (booking_id)
  where status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- Every profile gets a loyalty account
-- ---------------------------------------------------------------------------

create or replace function public.create_loyalty_account_for_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.loyalty_accounts (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger profiles_create_loyalty_account
  after insert on public.profiles
  for each row execute function public.create_loyalty_account_for_profile();

insert into public.loyalty_accounts (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_transactions enable row level security;
alter table public.rewards enable row level security;
alter table public.reward_redemptions enable row level security;

create policy "Users read their own points"
  on public.loyalty_accounts for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy "Users read their own points ledger"
  on public.loyalty_transactions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- The catalogue is public reference data: a passenger deciding whether to save
-- points needs to see what they are saving for.
create policy "Signed-in users read the rewards catalogue"
  on public.rewards for select to authenticated using (true);

create policy "Users read their own redemptions"
  on public.reward_redemptions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

revoke insert, update, delete on public.loyalty_accounts from anon, authenticated;
revoke insert, update, delete on public.loyalty_transactions from anon, authenticated;
revoke insert, update, delete on public.rewards from anon, authenticated;
revoke insert, update, delete on public.reward_redemptions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal: move the balance and write the ledger together.
--
-- Private. Callers must already hold the account row lock.
-- ---------------------------------------------------------------------------

create or replace function public.loyalty_post(
  p_user_id uuid,
  p_type public.loyalty_transaction_type,
  p_points integer,
  p_reference text default null,
  p_description text default null,
  p_booking_id uuid default null
)
returns public.loyalty_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before integer;
  v_after integer;
  v_row public.loyalty_transactions;
begin
  select points_balance into v_before
    from public.loyalty_accounts where user_id = p_user_id;

  if v_before is null then
    raise exception 'NOT_FOUND';
  end if;

  v_after := v_before + p_points;

  if v_after < 0 then
    raise exception 'INSUFFICIENT_POINTS';
  end if;

  insert into public.loyalty_transactions (
    user_id, type, points, balance_before, balance_after, reference, description, booking_id
  ) values (
    p_user_id, p_type, p_points, v_before, v_after, p_reference, p_description, p_booking_id
  )
  returning * into v_row;

  update public.loyalty_accounts
     set points_balance = v_after,
         -- Lifetime only counts credits, and only ever grows.
         lifetime_points = lifetime_points + greatest(0, p_points)
   where user_id = p_user_id;

  return v_row;
end;
$$;

revoke all on function public.loyalty_post(
  uuid, public.loyalty_transaction_type, integer, text, text, uuid
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- award_loyalty_for_booking
--
-- Called from `end_trip`, once per booking, ever. Points are computed from what
-- was actually PAID for the booking, not from its total: a booking whose
-- payment row says ₱0 earns nothing, and there is no path by which a client
-- influences the figure.
--
-- Returns the points awarded, or 0 when there was nothing to award — including
-- the already-awarded case, which is not an error.
-- ---------------------------------------------------------------------------

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

revoke all on function public.award_loyalty_for_booking(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- redeem_reward
--
-- Applies a reward to a booking that has not been paid for yet, reducing its
-- total. It must happen before payment, because `confirm_test_payment`
-- re-derives the amount and refuses a payment whose figure no longer matches
-- the booking — which is exactly the protection you want, and the reason a
-- discount cannot be bolted on afterwards.
--
-- The discount is computed server-side from the reward row. The client names a
-- reward, never an amount.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_reward(p_booking_id uuid, p_reward_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_booking public.bookings%rowtype;
  v_reward public.rewards%rowtype;
  v_account public.loyalty_accounts%rowtype;
  v_discount integer;
  v_new_total integer;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  -- Same lock order as everywhere else: booking, then the caller's accounts.
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_booking.user_id <> v_user_id then
    raise exception 'FORBIDDEN';
  end if;

  if v_booking.status not in ('PENDING', 'PAYMENT_PENDING') then
    raise exception 'BOOKING_ALREADY_CONFIRMED';
  end if;

  if v_booking.expires_at is not null and v_booking.expires_at < now() then
    raise exception 'BOOKING_EXPIRED';
  end if;

  if v_booking.loyalty_discount > 0 then
    raise exception 'REWARD_ALREADY_APPLIED';
  end if;

  select * into v_reward from public.rewards where id = p_reward_id and status = 'ACTIVE';
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_reward.discount_type = 'PERK' then
    -- No PERK rewards are seeded, and one that reduced nothing would be a
    -- feature that only exists as a table row. Refuse rather than pretend.
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_account
    from public.loyalty_accounts where user_id = v_user_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_account.points_balance < v_reward.points_required then
    raise exception 'INSUFFICIENT_POINTS';
  end if;

  v_discount := case v_reward.discount_type
    when 'FIXED' then v_reward.discount_value
    when 'PERCENTAGE' then least(
      (v_booking.subtotal * v_reward.discount_value) / 10000,
      coalesce(v_reward.max_discount, v_booking.subtotal)
    )
  end;

  -- Never more than the fare. A discount larger than the booking would either
  -- push the total negative (the check constraint would refuse it) or hand out
  -- change, and PalaGo does not owe anyone money.
  v_discount := least(v_discount, v_booking.subtotal - v_booking.discount);

  if v_discount <= 0 then
    raise exception 'VALIDATION_ERROR';
  end if;

  v_new_total := v_booking.subtotal - v_booking.discount - v_discount;

  -- A payment already created for the old total must not survive: its amount no
  -- longer matches the booking, and `confirm_test_payment` would refuse it with
  -- a message about validation rather than about the discount.
  update public.payments
     set status = 'CANCELLED', cancelled_at = now()
   where booking_id = v_booking.id and status = 'PENDING';

  update public.bookings
     set loyalty_discount = v_discount,
         total_amount = v_new_total
   where id = v_booking.id;

  perform public.loyalty_post(
    v_user_id, 'REDEEMED', -v_reward.points_required, v_booking.booking_reference,
    v_reward.name || ' on booking ' || v_booking.booking_reference, v_booking.id
  );

  insert into public.reward_redemptions (
    user_id, reward_id, booking_id, points_used, discount_applied
  ) values (
    v_user_id, v_reward.id, v_booking.id, v_reward.points_required, v_discount
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id, 'REWARD_REDEEMED', 'booking', v_booking.id,
    jsonb_build_object(
      'rewardCode', v_reward.code,
      'pointsUsed', v_reward.points_required,
      'discount', v_discount,
      'newTotal', v_new_total
    )
  );

  return jsonb_build_object(
    'bookingId', v_booking.id,
    'bookingReference', v_booking.booking_reference,
    'rewardCode', v_reward.code,
    'rewardName', v_reward.name,
    'pointsUsed', v_reward.points_required,
    'pointsBalance', v_account.points_balance - v_reward.points_required,
    'discount', v_discount,
    'subtotal', v_booking.subtotal,
    'totalAmount', v_new_total,
    'paymentCancelled', true
  );
end;
$$;

/**
 * Undo a redemption, giving the points back and restoring the total.
 *
 * Called by hand from the payment screen (a passenger changing their mind) and
 * automatically when a booking is cancelled or refunded. Without this, a
 * passenger who cancels loses points for a trip that never happened.
 */
create or replace function public.release_booking_redemption(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_redemption public.reward_redemptions%rowtype;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    return 0;
  end if;

  select * into v_redemption
    from public.reward_redemptions
   where booking_id = p_booking_id and status = 'ACTIVE'
   for update;

  if not found then
    return 0;
  end if;

  perform 1 from public.loyalty_accounts where user_id = v_redemption.user_id for update;

  perform public.loyalty_post(
    v_redemption.user_id, 'ADJUSTED', v_redemption.points_used,
    v_booking.booking_reference,
    'Points returned for booking ' || v_booking.booking_reference, p_booking_id
  );

  update public.reward_redemptions
     set status = 'INACTIVE', cancelled_at = now()
   where id = v_redemption.id;

  -- Restore the total only while the booking can still be paid. A booking that
  -- was already paid keeps the discounted figure it was actually charged.
  if v_booking.status in ('PENDING', 'PAYMENT_PENDING') then
    update public.bookings
       set loyalty_discount = 0,
           total_amount = v_booking.subtotal - v_booking.discount
     where id = p_booking_id;

    update public.payments
       set status = 'CANCELLED', cancelled_at = now()
     where booking_id = p_booking_id and status = 'PENDING';
  end if;

  return v_redemption.points_used;
end;
$$;

/** The passenger-facing wrapper: ownership checked, then release. */
create or replace function public.cancel_reward_redemption(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_booking public.bookings%rowtype;
  v_returned integer;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_booking.user_id <> v_user_id then
    raise exception 'FORBIDDEN';
  end if;

  if v_booking.status not in ('PENDING', 'PAYMENT_PENDING') then
    raise exception 'BOOKING_ALREADY_CONFIRMED';
  end if;

  v_returned := public.release_booking_redemption(p_booking_id);

  return jsonb_build_object(
    'bookingId', p_booking_id,
    'pointsReturned', v_returned,
    'totalAmount', v_booking.subtotal - v_booking.discount
  );
end;
$$;

revoke all on function public.release_booking_redemption(uuid) from public, anon, authenticated;
revoke all on function public.redeem_reward(uuid, uuid) from public, anon;
revoke all on function public.cancel_reward_redemption(uuid) from public, anon;
grant execute on function public.redeem_reward(uuid, uuid) to authenticated;
grant execute on function public.cancel_reward_redemption(uuid) to authenticated;
