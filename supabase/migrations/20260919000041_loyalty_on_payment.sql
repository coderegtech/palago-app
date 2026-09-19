-- ---------------------------------------------------------------------------
-- Loyalty points are earned on payment, at one point per ₱100.
--
-- Before: one point per ₱10, credited by `end_trip` once the trip was
-- COMPLETED. Now, as specified: floor(fare / ₱100) whole points, credited the
-- moment the booking's payment succeeds.
--
--   ₱100 → 1   ₱250 → 2   ₱560 → 5   ₱999 → 9   ₱99 → 0
--
-- The "fare" is what was actually PAID for the booking — the sum of its PAID
-- payment rows, after any senior/student/PWD discount and any reward the
-- passenger redeemed. Not the list price and not anything the client sends:
-- as before, there is no path by which a client influences the figure.
--
-- Where it hooks in. A payment becomes PAID in three functions today —
-- `confirm_test_payment`, `pay_booking_with_wallet` and
-- `record_counter_payment` — and more will follow when a real provider is
-- added. Patching each would leave the next one to remember. So the credit is
-- a trigger on `payments`: whatever path marks a payment PAID, the points
-- follow, in the same transaction.
--
-- Exactly once. `loyalty_transactions_one_earn_per_booking_idx` (Phase 10)
-- already allows one EARNED row per booking; a payment re-confirmed, a retried
-- webhook, `end_trip` running afterwards, or two of those racing — the second
-- insert is refused by the index and treated as "already credited". An index,
-- not a check, because check-then-insert races.
--
-- Refunds take the points back. Crediting at payment rather than at the end of
-- the trip opens a loop that the old rule did not have: pay, earn, refund, keep
-- the points, repeat. `refund_test_payment` moving a payment PAID → REFUNDED
-- now posts a REVERSED row for what that booking earned, also exactly once (its
-- own partial unique index). If the passenger has already spent some of those
-- points on a reward, the reversal takes what is left and the ledger says how
-- many had been spent — the balance cannot go negative (a constraint), and
-- failing the refund over it would hold the passenger's money hostage to their
-- points.
--
-- Walk-ins sold at a counter have no account and earn nothing, as before.
-- Points already earned under the old rate stay: the ledger is history.
-- ---------------------------------------------------------------------------

-- The rate. The client mirrors it in LOYALTY_CENTAVOS_PER_POINT for display
-- only; this function is the authority.
create or replace function public.loyalty_points_for(p_amount_centavos integer)
returns integer
language sql
immutable
as $$ select greatest(0, coalesce(p_amount_centavos, 0) / 10000) $$;

comment on function public.loyalty_points_for(integer) is
  'Points earned for an amount in centavos: floor(amount / ₱100). Whole points only.';

-- REVERSED is a debit.
alter table public.loyalty_transactions drop constraint loyalty_transactions_direction;
alter table public.loyalty_transactions add constraint loyalty_transactions_direction check (
  (type in ('EARNED', 'BONUS') and points > 0)
  or (type in ('REDEEMED', 'EXPIRED', 'REVERSED') and points < 0)
  or type = 'ADJUSTED'
);

create unique index loyalty_transactions_one_reversal_per_booking_idx
  on public.loyalty_transactions (user_id, booking_id)
  where booking_id is not null and type = 'REVERSED';

-- ---------------------------------------------------------------------------
-- award_loyalty_for_booking — now on payment
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

  -- A walk-in sold at the counter has no account to hold points.
  if v_booking.user_id is null then
    return 0;
  end if;

  -- A booking that has been cancelled or refunded earns nothing, whatever its
  -- payment rows say.
  if v_booking.status in ('CANCELLED', 'REFUNDED', 'NO_SHOW') then
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
      'Points for booking ' || v_booking.booking_reference, p_booking_id
    );
  exception when unique_violation then
    -- The exactly-once index did its job: this booking has already earned.
    return 0;
  end;

  insert into public.notifications (user_id, type, title, message, data)
  values (
    v_booking.user_id, 'REWARD', 'You earned ' || v_points
      || case when v_points = 1 then ' point' else ' points' end,
    'Booking ' || v_booking.booking_reference || ' earned you ' || v_points
      || case when v_points = 1 then ' point' else ' points' end
      || ' — one for every ₱100 paid.',
    jsonb_build_object('bookingId', p_booking_id, 'points', v_points)
  );

  return v_points;
end;
$$;

revoke all on function public.award_loyalty_for_booking(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- reverse_loyalty_for_booking — a refund takes the points back
-- ---------------------------------------------------------------------------

create or replace function public.reverse_loyalty_for_booking(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_earned public.loyalty_transactions%rowtype;
  v_reference text;
  v_balance integer;
  v_take integer;
begin
  select * into v_earned
    from public.loyalty_transactions
   where booking_id = p_booking_id and type = 'EARNED'
   limit 1;

  if not found then
    return 0; -- nothing was credited, so nothing to take back
  end if;

  select booking_reference into v_reference from public.bookings where id = p_booking_id;

  select points_balance into v_balance
    from public.loyalty_accounts where user_id = v_earned.user_id
    for update;

  -- Never below zero: points already spent on a reward stay spent.
  v_take := least(v_earned.points, coalesce(v_balance, 0));
  if v_take <= 0 then
    return 0;
  end if;

  begin
    perform public.loyalty_post(
      v_earned.user_id, 'REVERSED', -v_take, v_reference,
      'Points reversed: booking ' || v_reference || ' was refunded'
        || case when v_take < v_earned.points
             then ' (' || (v_earned.points - v_take) || ' had already been spent)'
             else '' end,
      p_booking_id
    );
  exception when unique_violation then
    return 0; -- already reversed
  end;

  -- Lifetime points record what was genuinely earned, and a refunded booking
  -- earned nothing — so the whole credit comes off, even the part already
  -- spent. `loyalty_post` only ever adds to lifetime (right for a redemption
  -- undone, which Phase 10 guards), so a pay-then-refund loop would otherwise
  -- inflate it without limit.
  update public.loyalty_accounts
     set lifetime_points = greatest(0, lifetime_points - v_earned.points)
   where user_id = v_earned.user_id;

  insert into public.notifications (user_id, type, title, message, data)
  values (
    v_earned.user_id, 'REWARD', v_take || case when v_take = 1 then ' point' else ' points' end
      || ' reversed',
    'Booking ' || v_reference || ' was refunded, so the points it earned have been taken back.',
    jsonb_build_object('bookingId', p_booking_id, 'points', -v_take)
  );

  return v_take;
end;
$$;

revoke all on function public.reverse_loyalty_for_booking(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The trigger: every path that pays or refunds goes through here
-- ---------------------------------------------------------------------------

create or replace function public.payments_sync_loyalty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'PAID'
     and (tg_op = 'INSERT' or old.status is distinct from 'PAID') then
    perform public.award_loyalty_for_booking(new.booking_id);
  elsif new.status = 'REFUNDED' and tg_op = 'UPDATE' and old.status = 'PAID' then
    perform public.reverse_loyalty_for_booking(new.booking_id);
  end if;
  return null;
end;
$$;

revoke all on function public.payments_sync_loyalty() from public, anon, authenticated;

-- AFTER, so the payment row is committed-visible to the sum in the award.
create trigger payments_sync_loyalty
  after insert or update of status on public.payments
  for each row execute function public.payments_sync_loyalty();

-- ---------------------------------------------------------------------------
-- Bookings already paid for when this lands, and not yet credited, are
-- credited now at the new rate — otherwise they would wait for `end_trip`,
-- which still calls the award and now simply finds it done. Idempotent.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select distinct p.booking_id
      from public.payments p
      join public.bookings b on b.id = p.booking_id
     where p.status = 'PAID'
       and b.user_id is not null
       and b.status not in ('CANCELLED', 'REFUNDED', 'NO_SHOW')
       and not exists (
         select 1 from public.loyalty_transactions lt
          where lt.booking_id = p.booking_id and lt.type = 'EARNED'
       )
  loop
    perform public.award_loyalty_for_booking(r.booking_id);
  end loop;
end;
$$;
